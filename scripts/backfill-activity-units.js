#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = {
    apply: false,
    planId: null,
    athleteId: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') {
      args.apply = true;
      continue;
    }
    if (token === '--plan') {
      args.planId = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (token === '--athlete') {
      args.athleteId = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      console.log(
        [
          'Usage: node scripts/backfill-activity-units.js [--apply] [--plan <planId>] [--athlete <athleteId>]',
          '',
          'Normalizes plan activity unit metadata:',
          '- sets distanceUnit when distance/actualDistance exists and unit can be inferred',
          '- ensures paceTarget/actualPace include /km or /mi for plain pace values',
          '',
          'By default this runs as dry-run (no writes).'
        ].join('\n')
      );
      process.exit(0);
    }
  }
  return args;
}

function normalizeDistanceUnit(unit) {
  if (!unit || typeof unit !== 'string') return null;
  const token = unit.trim().toUpperCase();
  if (token === 'KM') return 'KM';
  if (token === 'MILES' || token === 'MI' || token === 'MILE') return 'MILES';
  return null;
}

function inferDistanceUnitFromPaceText(value) {
  if (!value || typeof value !== 'string') return null;
  const match = /(?:\/|per)\s*(mi|mile|miles|km|k)\b/i.exec(value.trim());
  if (!match) return null;
  const token = match[1].toLowerCase();
  if (token === 'km' || token === 'k') return 'KM';
  return 'MILES';
}

function looksLikePlainPace(value) {
  const match = /^(\d{1,2})\s*:\s*(\d{2})(?:\s*(?:-|–|—|to)\s*(\d{1,2})\s*:\s*(\d{2}))?$/.exec(value);
  if (!match) return false;
  const first = Number(match[2]);
  const second = match[4] ? Number(match[4]) : null;
  if (first > 59) return false;
  if (second !== null && second > 59) return false;
  return true;
}

function distanceUnitLabel(unit) {
  return unit === 'KM' ? 'km' : 'mi';
}

function normalizePaceForStorage(rawPace, unit) {
  if (!rawPace || typeof rawPace !== 'string') return null;
  const trimmed = rawPace.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, ' /')
    .replace(/\s*-\s*/g, '-')
    .trim();
  if (inferDistanceUnitFromPaceText(normalized)) return normalized;
  if (unit && looksLikePlainPace(normalized)) {
    return `${normalized} /${distanceUnitLabel(unit)}`;
  }
  return normalized;
}

function resolveDistanceUnit(activity, fallbackUnit) {
  return (
    normalizeDistanceUnit(activity.distanceUnit)
    || inferDistanceUnitFromPaceText(activity.paceTarget)
    || inferDistanceUnitFromPaceText(activity.actualPace)
    || normalizeDistanceUnit(fallbackUnit)
    || null
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run this script.');
  }
  const activities = await prisma.planActivity.findMany({
    where: {
      ...(args.planId ? { planId: args.planId } : {}),
      ...(args.athleteId ? { plan: { athleteId: args.athleteId } } : {})
    },
    select: {
      id: true,
      planId: true,
      distance: true,
      actualDistance: true,
      distanceUnit: true,
      paceTarget: true,
      actualPace: true,
      plan: {
        select: {
          athlete: { select: { units: true } },
          owner: { select: { units: true } }
        }
      }
    }
  });

  let scanned = 0;
  let needsUpdate = 0;
  let unresolvedDistance = 0;
  const updates = [];

  for (const activity of activities) {
    scanned += 1;
    const fallbackUnit = activity.plan?.athlete?.units || activity.plan?.owner?.units || null;
    const resolvedUnit = resolveDistanceUnit(activity, fallbackUnit);

    const data = {};
    const hasDistanceValue = activity.distance !== null || activity.actualDistance !== null;
    if (hasDistanceValue && !activity.distanceUnit) {
      if (resolvedUnit) data.distanceUnit = resolvedUnit;
      else unresolvedDistance += 1;
    }

    const normalizedPaceTarget = normalizePaceForStorage(activity.paceTarget, resolvedUnit);
    if ((activity.paceTarget || null) !== normalizedPaceTarget) {
      data.paceTarget = normalizedPaceTarget;
    }

    const normalizedActualPace = normalizePaceForStorage(activity.actualPace, resolvedUnit);
    if ((activity.actualPace || null) !== normalizedActualPace) {
      data.actualPace = normalizedActualPace;
    }

    if (Object.keys(data).length > 0) {
      needsUpdate += 1;
      updates.push({ id: activity.id, data });
    }
  }

  if (args.apply && updates.length > 0) {
    for (const update of updates) {
      await prisma.planActivity.update({
        where: { id: update.id },
        data: update.data
      });
    }
  }

  console.log(`${args.apply ? 'APPLY' : 'DRY RUN'}: backfill activity units`);
  console.log(`- activities scanned: ${scanned}`);
  console.log(`- activities needing update: ${needsUpdate}`);
  console.log(`- unresolved with missing distanceUnit: ${unresolvedDistance}`);
  console.log(`- updates applied: ${args.apply ? updates.length : 0}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
