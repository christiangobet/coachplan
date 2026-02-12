import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseWeekWithAI } from '@/lib/ai-plan-parser';

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

function titleCase(text: string) {
  return text
    .replace(/-/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ')
    .trim();
}

function inferSubtype(text: string) {
  const t = text.toLowerCase();
  if (t.includes('strength')) return 'strength';
  if (t.includes('rest')) return 'rest';
  if (t.includes('cross') || t.includes('xt')) return 'cross-training';
  if (t.includes('training race')) return 'training-race';
  if (t.includes('race')) return 'race';
  if (t.includes('incline treadmill')) return 'incline-treadmill';
  if (t.includes('hill pyramid')) return 'hill-pyramid';
  if (t.includes('hills')) return 'hills';
  if (t.includes('tempo')) return 'tempo';
  if (t.includes('progress')) return 'progression';
  if (t.includes('recovery')) return 'recovery';
  if (t.includes('trail')) return 'trail-run';
  if (t.includes('fast finish')) return 'fast-finish';
  if (t.includes('lrl')) return 'lrl';
  if (t.includes('hike')) return 'hike';
  if (t.includes('easy')) return 'easy-run';
  return 'unknown';
}

function mapActivityType(subtype: string) {
  if (subtype === 'strength') return 'STRENGTH';
  if (subtype === 'cross-training') return 'CROSS_TRAIN';
  if (subtype === 'rest') return 'REST';
  if (subtype === 'hike') return 'HIKE';
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
  const wuMatch = text.match(/(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|km|kilometer|kilometre)\s*WU/i);
  if (wuMatch) {
    const range = parseRange(wuMatch[1].replace(/\s/g, ''));
    if (range) structure.warmup = { distance: range, unit: wuMatch[0].toLowerCase().includes('km') ? 'km' : 'miles' };
  }
  const cdMatch = text.match(/(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|km|kilometer|kilometre)\s*CD/i);
  if (cdMatch) {
    const range = parseRange(cdMatch[1].replace(/\s/g, ''));
    if (range) structure.cooldown = { distance: range, unit: cdMatch[0].toLowerCase().includes('km') ? 'km' : 'miles' };
  }
  const tempoMatch = text.match(/T[:\s]\s*(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|km|kilometer|kilometre)/i);
  if (tempoMatch) {
    const range = parseRange(tempoMatch[1].replace(/\s/g, ''));
    if (range) structure.tempo = { distance: range, unit: tempoMatch[0].toLowerCase().includes('km') ? 'km' : 'miles' };
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
  let raceDate: string | null = null;
  let file: File | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    name = String(form.get('name') || '').trim();
    raceDate = form.get('raceDate') ? String(form.get('raceDate')) : null;
    const maybeFile = form.get('file');
    if (maybeFile instanceof File) file = maybeFile;
  } else {
    const body = await req.json();
    name = String(body?.name || '').trim();
    raceDate = body?.raceDate ? String(body.raceDate) : null;
  }

  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const plan = await prisma.trainingPlan.create({
    data: {
      name,
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
              activities.push({
                planId: plan.id,
                dayId: day.id,
                type: a.type === 'cross_train' ? 'CROSS_TRAIN' : (a.type || 'OTHER').toUpperCase(),
                subtype: a.subtype || null,
                title: a.title,
                rawText: a.raw_text || entry.raw || null,
                distance: a.metrics?.distance?.value ?? null,
                distanceUnit: a.metrics?.distance?.unit === 'km' ? 'KM' : a.metrics?.distance?.unit === 'miles' ? 'MILES' : null,
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
                const distance =
                  metrics?.distance_miles ??
                  metrics?.distance_miles_range?.[1] ??
                  null;
                const duration =
                  metrics?.duration_minutes ??
                  metrics?.duration_minutes_range?.[1] ??
                  null;

                const structure = parseStructure(originalText);
                const title =
                  activityType === 'REST'
                    ? 'Rest day'
                    : titleCase(subtype === 'unknown' ? 'Workout' : subtype);

                activities.push({
                  planId: plan.id,
                  dayId: day.id,
                  type: activityType,
                  subtype,
                  title,
                  rawText: cleanText || originalText,
                  distance,
                  distanceUnit: distance ? 'MILES' : null,
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
    } catch (error) {
      return NextResponse.json(
        { error: 'Parse failed', details: (error as Error).message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ plan });
}
