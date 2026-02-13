import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseWeekWithAI } from '@/lib/ai-plan-parser';
import { alignWeeksToRaceDate } from '@/lib/clone-plan';

const execFileAsync = promisify(execFile);
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const RUN_SUBTYPES = new Set([
  'tempo',
  'hills',
  'hill-pyramid',
  'incline-treadmill',
  'progression',
  'trail-run',
  'recovery',
  'easy-run',
  'training-race',
  'race',
  'fast-finish',
  'lrl',
  'unknown'
]);

const SUBTYPE_TITLES: Record<string, string> = {
  'lrl': 'Long Run',
  'easy-run': 'Easy Run',
  'tempo': 'Tempo Run',
  'hills': 'Hill Workout',
  'hill-pyramid': 'Hill Pyramid',
  'incline-treadmill': 'Incline Treadmill',
  'progression': 'Progression Run',
  'trail-run': 'Trail Run',
  'recovery': 'Recovery Run',
  'fast-finish': 'Fast Finish',
  'training-race': 'Training Race',
  'race': 'Race',
  'strength': 'Strength',
  'cross-training': 'Cross Training',
  'hike': 'Hike',
};

function titleCase(text: string) {
  return text
    .replace(/-/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ')
    .trim();
}

function planNameFromFilename(filename: string) {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  const normalized = withoutExt.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized || 'Uploaded Plan';
}

type DistanceParseResult = {
  distance: number | null;
  distanceUnit: 'MILES' | 'KM' | null;
};

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function asUpperDistanceUnit(token: unknown): 'MILES' | 'KM' | 'M' | null {
  if (!token || typeof token !== 'string') return null;
  const unit = token.trim().toLowerCase();
  if (unit === 'mile' || unit === 'miles' || unit === 'mi') return 'MILES';
  if (unit === 'km' || unit === 'kms' || unit === 'kilometer' || unit === 'kilometre' || unit === 'kilometers' || unit === 'kilometres') return 'KM';
  if (unit === 'm' || unit === 'meter' || unit === 'metre' || unit === 'meters' || unit === 'metres') return 'M';
  return null;
}

function hasMetersNotation(text: string) {
  const t = text.toLowerCase();
  if (/\d+(?:\.\d+)?\s*(?:meters?|metres?)\b/.test(t)) return true;
  if (/\b(?:reps?|strides?|interval)\b/.test(t) && /\d{2,4}\s*m\b/.test(t)) return true;
  return /\d{3,4}\s*m\b/.test(t);
}

function inferDistanceUnitFromText(text: string): 'MILES' | 'KM' | 'M' | null {
  const t = text.toLowerCase();
  if (/\d+(?:\.\d+)?\s*(?:miles?|mile|mi)\b/.test(t)) return 'MILES';
  if (/\d+(?:\.\d+)?\s*(?:km|kms|kilometers?|kilometres?)\b/.test(t)) return 'KM';
  if (hasMetersNotation(t)) return 'M';
  return null;
}

function normalizeDistanceValue(distance: number | null, unit: 'MILES' | 'KM' | 'M' | null): DistanceParseResult {
  if (distance === null || !Number.isFinite(distance) || distance <= 0 || !unit) {
    return { distance: null, distanceUnit: null };
  }
  if (unit === 'M') {
    return { distance: distance / 1000, distanceUnit: 'KM' };
  }
  return { distance, distanceUnit: unit };
}

function resolveDistanceFromValueUnit(
  distanceCandidate: unknown,
  unitCandidate: unknown,
  rawText: string
): DistanceParseResult {
  const numeric = parseNumber(distanceCandidate);
  let unit = asUpperDistanceUnit(unitCandidate);
  if (!unit) unit = inferDistanceUnitFromText(rawText);
  return normalizeDistanceValue(numeric, unit);
}

function resolveDistanceFromSegmentMetrics(metrics: Record<string, unknown>, rawText: string): DistanceParseResult {
  const direct = resolveDistanceFromValueUnit(metrics?.distance_value, metrics?.distance_unit, rawText);
  if (direct.distance !== null) return direct;

  const fromMiles = resolveDistanceFromValueUnit(
    metrics?.distance_miles ?? (metrics?.distance_miles_range as number[] | undefined)?.[1] ?? null,
    'miles',
    rawText
  );
  if (fromMiles.distance !== null) return fromMiles;

  const fromKm = resolveDistanceFromValueUnit(
    metrics?.distance_km ?? (metrics?.distance_km_range as number[] | undefined)?.[1] ?? null,
    'km',
    rawText
  );
  if (fromKm.distance !== null) return fromKm;

  const fromMeters = resolveDistanceFromValueUnit(
    metrics?.distance_meters ?? (metrics?.distance_meters_range as number[] | undefined)?.[1] ?? null,
    'm',
    rawText
  );
  if (fromMeters.distance !== null) return fromMeters;

  return { distance: null, distanceUnit: null };
}

function inferSubtype(text: string) {
  const t = text.toLowerCase();
  if (t.includes('strength') || /\bst\s*\d/i.test(t)) return 'strength';
  if (/\brest\s*(day)?\b/.test(t)) return 'rest';
  if (t.includes('cross') || t.includes('xt')) return 'cross-training';
  if (t.includes('training race')) return 'training-race';
  if (/\brace\b/.test(t)) return 'race';
  if (t.includes('incline treadmill')) return 'incline-treadmill';
  if (t.includes('hill pyramid')) return 'hill-pyramid';
  if (/\bhills?\b/.test(t)) return 'hills';
  if (/\btempo\b/.test(t) || /\bT[:\s]\d/.test(text)) return 'tempo';
  if (t.includes('progress')) return 'progression';
  if (t.includes('recovery') || /\brec\b/.test(t)) return 'recovery';
  if (/\btrail\b/.test(t)) return 'trail-run';
  if (t.includes('fast finish') || /\bff\b/.test(t)) return 'fast-finish';
  if (/\blrl\b/.test(t) || /\blong run\b/.test(t) || /\blr\b/.test(t)) return 'lrl';
  if (/\bhike\b/.test(t)) return 'hike';
  if (/\byoga\b/.test(t)) return 'yoga';
  if (/\beasy\b/.test(t) || /\be\s+\d/.test(t)) return 'easy-run';
  // If text contains distance info, likely a run
  if (/\d+(?:\.\d+)?\s*(?:miles?|mi|km|meters?|metres?)\b/.test(t) || /\d{3,4}\s*m\b/.test(t)) {
    return 'easy-run';
  }
  return 'unknown';
}

function mapActivityType(subtype: string) {
  if (subtype === 'strength') return 'STRENGTH';
  if (subtype === 'cross-training') return 'CROSS_TRAIN';
  if (subtype === 'rest') return 'REST';
  if (subtype === 'hike') return 'HIKE';
  if (subtype === 'yoga') return 'OTHER';
  if (RUN_SUBTYPES.has(subtype)) return 'RUN';
  return 'OTHER';
}

function parseRange(value: string) {
  const parts = value.split('-').map((v) => Number(v.trim()));
  if (parts.length === 2 && parts.every((v) => !Number.isNaN(v))) {
    return { min: parts[0], max: parts[1] };
  }
  const single = Number(value);
  if (!Number.isNaN(single)) return { min: single, max: single };
  return null;
}

function parseStructure(text: string) {
  const structure: any = {};
  const wuMatch = text.match(/(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|km|kilometer|kilometre|meter|meters|metre|metres|m)\s*WU/i);
  if (wuMatch) {
    const range = parseRange(wuMatch[1].replace(/\s/g, ''));
    if (range) {
      const matchUnit = inferDistanceUnitFromText(wuMatch[0]) || 'MILES';
      structure.warmup = { distance: range, unit: matchUnit === 'M' ? 'm' : matchUnit.toLowerCase() };
    }
  }
  const cdMatch = text.match(/(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|km|kilometer|kilometre|meter|meters|metre|metres|m)\s*CD/i);
  if (cdMatch) {
    const range = parseRange(cdMatch[1].replace(/\s/g, ''));
    if (range) {
      const matchUnit = inferDistanceUnitFromText(cdMatch[0]) || 'MILES';
      structure.cooldown = { distance: range, unit: matchUnit === 'M' ? 'm' : matchUnit.toLowerCase() };
    }
  }
  const tempoMatch = text.match(/T[:\s]\s*(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|km|kilometer|kilometre|meter|meters|metre|metres|m)/i);
  if (tempoMatch) {
    const range = parseRange(tempoMatch[1].replace(/\s/g, ''));
    if (range) {
      const matchUnit = inferDistanceUnitFromText(tempoMatch[0]) || 'MILES';
      structure.tempo = { distance: range, unit: matchUnit === 'M' ? 'm' : matchUnit.toLowerCase() };
    }
  }
  const intervalMatch = text.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(second|seconds|sec|minute|minutes|min)/i);
  if (intervalMatch) {
    const reps = Number(intervalMatch[1]);
    const duration = Number(intervalMatch[2]);
    const unit = intervalMatch[3].startsWith('s') ? 'sec' : 'min';
    structure.intervals = [
      {
        reps,
        work: { duration: unit === 'sec' ? duration : duration * 60, unit: 'sec' }
      }
    ];
  }
  return Object.keys(structure).length ? structure : null;
}

function expandAlternatives(text: string) {
  const restOr = text.match(/rest day or (.+)/i) || text.match(/rest or (.+)/i);
  if (restOr) {
    return ['Rest day', restOr[1]];
  }
  return [text];
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const plans = await prisma.trainingPlan.findMany({
    where: { athleteId: user.id, isTemplate: false },
    orderBy: { createdAt: 'desc' }
  });

  return NextResponse.json({ plans });
}

async function parsePdfToJson(planId: string, pdfPath: string, name: string) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'parse_plan_pdf.py');
  const outputDir = path.join(process.cwd(), 'tmp', 'parsed');
  const outputPath = path.join(outputDir, `${planId}.json`);
  await fs.mkdir(outputDir, { recursive: true });

  await execFileAsync('python3', [
    scriptPath,
    '--input',
    pdfPath,
    '--output',
    outputPath,
    '--name',
    name
  ]);

  const raw = await fs.readFile(outputPath, 'utf-8');
  return JSON.parse(raw);
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const contentType = req.headers.get('content-type') || '';
  let name = '';
  let raceName: string | null = null;
  let raceDate: string | null = null;
  let file: File | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    name = String(form.get('name') || '').trim();
    raceName = form.get('raceName') ? String(form.get('raceName')).trim() : null;
    raceDate = form.get('raceDate') ? String(form.get('raceDate')) : null;
    const maybeFile = form.get('file');
    if (maybeFile instanceof File) file = maybeFile;
    if (file && file.size > 0 && file.name) {
      name = planNameFromFilename(file.name);
    }
  } else {
    const body = await req.json();
    name = String(body?.name || '').trim();
    raceName = body?.raceName ? String(body.raceName).trim() : null;
    raceDate = body?.raceDate ? String(body.raceDate) : null;
  }

  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const plan = await prisma.trainingPlan.create({
    data: {
      name,
      raceName: raceName || null,
      raceDate: raceDate ? new Date(raceDate) : null,
      isTemplate: false,
      status: 'DRAFT',
      ownerId: user.id,
      athleteId: user.id
    }
  });

  if (file && file.size > 0) {
    const uploadDir = path.join(process.cwd(), 'tmp', 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfPath = path.join(uploadDir, `${plan.id}.pdf`);
    await fs.writeFile(pdfPath, buffer);

    try {
      const parsed = await parsePdfToJson(plan.id, pdfPath, name);
      const weeks = Array.isArray(parsed?.weeks) ? parsed.weeks : [];

      const weekRecords: { id: string }[] = [];
      for (let i = 0; i < weeks.length; i += 1) {
        weekRecords.push(
          await prisma.planWeek.create({
            data: {
              planId: plan.id,
              weekIndex: i + 1
            }
          })
        );
      }

      const activities: any[] = [];
      for (let i = 0; i < weeks.length; i += 1) {
        const week = weeks[i];
        const weekId = weekRecords[i]?.id;
        const rawDays: Record<string, string> = {};
        DAY_KEYS.forEach((key) => {
          rawDays[key] = week?.days?.[key]?.raw || '';
        });

        let aiWeek = null;
        try {
          aiWeek = await parseWeekWithAI({
            planName: name,
            weekNumber: i + 1,
            days: rawDays,
            legend: parsed?.glossary?.note || undefined
          });
        } catch {
          aiWeek = null;
        }

        for (let d = 0; d < DAY_KEYS.length; d += 1) {
          const key = DAY_KEYS[d];
          const entry = week?.days?.[key];
          if (!entry) continue;

          const day = await prisma.planDay.create({
            data: {
              planId: plan.id,
              weekId,
              dayOfWeek: d + 1,
              rawText: entry.raw || null
            }
          });

          const aiActivities = aiWeek?.days?.[key]?.activities || [];
          if (aiActivities.length) {
            for (const a of aiActivities) {
              const aiDistance = resolveDistanceFromValueUnit(
                a.metrics?.distance?.value ?? null,
                a.metrics?.distance?.unit ?? null,
                a.raw_text || entry.raw || ''
              );
              activities.push({
                planId: plan.id,
                dayId: day.id,
                type: a.type === 'cross_train' ? 'CROSS_TRAIN' : (a.type || 'OTHER').toUpperCase(),
                subtype: a.subtype || null,
                title: a.title,
                rawText: a.raw_text || entry.raw || null,
                distance: aiDistance.distance,
                distanceUnit: aiDistance.distanceUnit,
                duration: a.metrics?.duration_min ?? null,
                paceTarget: a.metrics?.pace_target ?? null,
                effortTarget: a.metrics?.effort_target ?? null,
                structure: a.structure || null,
                tags: a.tags || null,
                priority: a.priority ? a.priority.toUpperCase() : null,
                bailAllowed: a.constraints?.bail_allowed ?? false,
                mustDo: a.constraints?.must_do ?? false
              });
            }
          } else {
            const segments = entry?.segments_parsed?.length
              ? entry.segments_parsed
              : [
                  {
                    text: entry.raw || '',
                    type: entry.type_guess || 'unknown',
                    metrics: entry.metrics || {}
                  }
                ];

            for (const seg of segments) {
              const variants = expandAlternatives(seg.text || '');
              for (const variantText of variants) {
                const originalText = variantText.trim();
                if (!originalText) continue;

                const inferred = inferSubtype(originalText);
                const subtype = inferred !== 'unknown' ? inferred : (seg.type || 'unknown');
                const activityType = mapActivityType(subtype);
                const cleanText = originalText.replace(/[★♥]/g, '').trim();
                const mustDo = originalText.includes('★');
                const bailAllowed = originalText.includes('♥');

                const metrics = seg.metrics || {};
                const parsedDistance = resolveDistanceFromSegmentMetrics(metrics, originalText);
                const duration =
                  metrics?.duration_minutes ??
                  metrics?.duration_minutes_range?.[1] ??
                  null;

                const structure = parseStructure(originalText);
                const title =
                  activityType === 'REST'
                    ? 'Rest Day'
                    : SUBTYPE_TITLES[subtype] || titleCase(subtype === 'unknown' ? 'Workout' : subtype);

                activities.push({
                  planId: plan.id,
                  dayId: day.id,
                  type: activityType,
                  subtype,
                  title,
                  rawText: cleanText || originalText,
                  distance: parsedDistance.distance,
                  distanceUnit: parsedDistance.distanceUnit,
                  duration,
                  structure: structure || null,
                  priority: mustDo ? 'KEY' : bailAllowed ? 'OPTIONAL' : null,
                  mustDo,
                  bailAllowed
                });
              }
            }
          }
        }
      }

      if (activities.length) {
        await prisma.planActivity.createMany({ data: activities });
      }

      await prisma.trainingPlan.update({
        where: { id: plan.id },
        data: {
          weekCount: weeks.length || null,
          status: 'DRAFT'
        }
      });

      if (raceDate && weeks.length > 0) {
        const parsedRaceDate = new Date(raceDate);
        if (!Number.isNaN(parsedRaceDate.getTime())) {
          await alignWeeksToRaceDate(plan.id, weeks.length, parsedRaceDate);
        }
      }
    } catch (error) {
      return NextResponse.json(
        { error: 'Parse failed', details: (error as Error).message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ plan });
}
