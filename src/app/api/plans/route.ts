import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseWeekWithAI } from '@/lib/ai-plan-parser';
import { alignWeeksToRaceDate } from '@/lib/clone-plan';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pathToFileURL } from 'url';

export const runtime = 'nodejs';
export const maxDuration = 300;

const execFileAsync = promisify(execFile);
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const TABLE_LABELS = ['WEEK', ...DAY_LABELS];
const ENABLE_AI_WEEK_PARSE = process.env.ENABLE_AI_WEEK_PARSE === 'true';

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

type PdfTextItem = {
  str: string;
  x: number;
  y: number;
};

type RowCluster = {
  y: number;
  items: PdfTextItem[];
};

function normalizeWhitespace(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+\+\s+/g, ' + ')
    .trim();
}

function clusterRows(items: PdfTextItem[], tolerance = 2): RowCluster[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const clusters: RowCluster[] = [];

  for (const item of sorted) {
    const cluster = clusters.find((c) => Math.abs(c.y - item.y) <= tolerance);
    if (!cluster) {
      clusters.push({ y: item.y, items: [item] });
      continue;
    }
    cluster.items.push(item);
  }

  return clusters
    .map((cluster) => ({
      y: cluster.y,
      items: cluster.items.sort((a, b) => a.x - b.x)
    }))
    .sort((a, b) => b.y - a.y);
}

function nearestIndex(target: number, anchors: number[]) {
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < anchors.length; i += 1) {
    const dist = Math.abs(target - anchors[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return { index: bestIdx, distance: bestDist };
}

function findTableHeader(items: PdfTextItem[]) {
  const labels = items.filter((item) => TABLE_LABELS.includes(item.str.toUpperCase()));
  const mondayRows = labels.filter((item) => item.str.toUpperCase() === 'MONDAY');

  for (const monday of mondayRows) {
    const row = labels.filter((item) => Math.abs(item.y - monday.y) <= 2);
    const names = new Set(row.map((item) => item.str.toUpperCase()));
    if (!TABLE_LABELS.every((label) => names.has(label))) continue;

    const columns = TABLE_LABELS.map((label) => {
      const candidates = row
        .filter((item) => item.str.toUpperCase() === label)
        .sort((a, b) => a.x - b.x);
      return candidates[0]?.x ?? 0;
    });

    return { y: monday.y, columns };
  }

  return null;
}

async function parsePdfToJsonNode(pdfPath: string, name: string) {
  const bytes = await fs.readFile(pdfPath);
  const workerPath = path.join(
    process.cwd(),
    'node_modules',
    'pdfjs-dist',
    'legacy',
    'build',
    'pdf.worker.mjs'
  );
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const loadingTask = (pdfjsLib as any).getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true
  });
  const pdf = await loadingTask.promise;
  const weeks = new Map<number, Record<string, string[]>>();

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const items: PdfTextItem[] = (textContent.items as any[])
      .map((item) => ({
        str: String(item.str || '').trim(),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0)
      }))
      .filter((item) => item.str);

    const header = findTableHeader(items);
    if (!header) continue;

    const bodyItems = items.filter((item) => (
      item.y < header.y - 3
      && item.y > 70
      && item.x < 740
    ));

    const rows = clusterRows(bodyItems).map((cluster) => {
      const cellParts: string[][] = Array.from({ length: 8 }, () => []);

      for (const item of cluster.items) {
        const nearest = nearestIndex(item.x, header.columns);
        if (nearest.distance > 75) continue;
        cellParts[nearest.index].push(item.str);
      }

      return {
        y: cluster.y,
        cells: cellParts.map((parts) => normalizeWhitespace(parts.join(' ')))
      };
    }).filter((row) => row.cells.some(Boolean));

    const markers = rows
      .filter((row) => /^\d{1,2}$/.test(row.cells[0]))
      .map((row) => ({ y: row.y, week: Number(row.cells[0]) }));

    if (!markers.length) continue;

    for (const row of rows) {
      const dayCells = row.cells.slice(1);
      if (!dayCells.some((cell) => cell.length > 0)) continue;

      const nearestMarker = markers.reduce((best, marker) => {
        if (!best) return marker;
        return Math.abs(marker.y - row.y) < Math.abs(best.y - row.y) ? marker : best;
      }, null as { y: number; week: number } | null);

      if (!nearestMarker) continue;
      const weekNumber = nearestMarker.week;

      if (!weeks.has(weekNumber)) {
        weeks.set(weekNumber, DAY_KEYS.reduce((acc, day) => {
          acc[day] = [];
          return acc;
        }, {} as Record<string, string[]>));
      }

      const bucket = weeks.get(weekNumber)!;
      for (let i = 0; i < DAY_KEYS.length; i += 1) {
        const cell = dayCells[i];
        if (!cell) continue;
        bucket[DAY_KEYS[i]].push(cell);
      }
    }
  }

  const parsedWeeks = [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekNumber, dayValues]) => ({
      week_number: weekNumber,
      days: DAY_KEYS.reduce((acc, day) => {
        const raw = normalizeWhitespace((dayValues[day] || []).join(' '))
          .replace(/\b([A-Za-z]+)-([A-Za-z]+)\b/g, '$1$2');
        acc[day] = { raw };
        return acc;
      }, {} as Record<string, { raw: string }>)
    }));

  if (!parsedWeeks.length) {
    throw new Error('Node parser found no recognizable week/day table in this PDF.');
  }

  return {
    source_pdf: path.basename(pdfPath),
    program_name: name,
    generated_at: new Date().toISOString(),
    weeks: parsedWeeks,
    glossary: {
      sections: [],
      entries: {},
      review_needed: [],
      note: 'Parsed with Node fallback parser.'
    }
  };
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
  if (process.env.VERCEL) {
    return parsePdfToJsonNode(pdfPath, name);
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'parse_plan_pdf.py');
  const outputDir = path.join(os.tmpdir(), 'coachplan', 'parsed');
  const outputPath = path.join(outputDir, `${planId}.json`);
  await fs.mkdir(outputDir, { recursive: true });

  try {
    await execFileAsync(
      'python3',
      [
        scriptPath,
        '--input',
        pdfPath,
        '--output',
        outputPath,
        '--name',
        name
      ],
      { timeout: 180000, maxBuffer: 8 * 1024 * 1024 }
    );
  } catch (error) {
    const err = error as Error & { stderr?: string; message: string };
    const details = err.stderr?.trim() || err.message || 'Unknown parser failure';
    if (details.includes('ENOENT') || details.toLowerCase().includes('no such file')) {
      return parsePdfToJsonNode(pdfPath, name);
    }
    throw new Error(`PDF parse failed: ${details}`);
  }

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

  let parseWarning: string | null = null;
  if (file && file.size > 0) {
    const uploadDir = path.join(os.tmpdir(), 'coachplan', 'uploads');

    try {
      await fs.mkdir(uploadDir, { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      const pdfPath = path.join(uploadDir, `${plan.id}.pdf`);
      await fs.writeFile(pdfPath, buffer);

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
        if (ENABLE_AI_WEEK_PARSE) {
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
      const reason = (error as Error).message || 'Unknown parser error';
      parseWarning = reason;
      console.error('Plan parse failed, creating fallback editable skeleton', { planId: plan.id, reason });

      const existingWeeks = await prisma.planWeek.count({ where: { planId: plan.id } });
      if (existingWeeks === 0) {
        const fallbackWeek = await prisma.planWeek.create({
          data: {
            planId: plan.id,
            weekIndex: 1
          }
        });

        await prisma.planDay.createMany({
          data: Array.from({ length: 7 }).map((_, idx) => ({
            planId: plan.id,
            weekId: fallbackWeek.id,
            dayOfWeek: idx + 1,
            rawText: idx === 0
              ? 'Parser fallback mode: add/edit activities manually for this plan.'
              : null
          }))
        });

        await prisma.trainingPlan.update({
          where: { id: plan.id },
          data: {
            weekCount: 1,
            status: 'DRAFT'
          }
        });
      }
    }
  }

  const latestPlan = await prisma.trainingPlan.findUnique({
    where: { id: plan.id }
  });

  return NextResponse.json({
    plan: latestPlan || plan,
    parseWarning
  });
}
