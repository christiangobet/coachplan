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
          'Usage: node scripts/backfill-plan-dates.js [--apply] [--plan <planId>] [--athlete <athleteId>]',
          '',
          'By default this is a dry run (no writes).',
          'Use --apply to persist aligned start/end dates for each week.',
          '',
          'Examples:',
          '  node scripts/backfill-plan-dates.js',
          '  node scripts/backfill-plan-dates.js --apply',
          '  node scripts/backfill-plan-dates.js --apply --athlete user_123',
          '  node scripts/backfill-plan-dates.js --apply --plan clxyz...'
        ].join('\n')
      );
      process.exit(0);
    }
  }

  return args;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getRaceWeekSunday(raceDate) {
  const sunday = startOfDay(raceDate);
  const dayOfWeek = sunday.getDay(); // 0 = Sunday
  if (dayOfWeek !== 0) {
    sunday.setDate(sunday.getDate() + (7 - dayOfWeek));
  }
  return sunday;
}

function resolveTotalWeeks(plan) {
  const maxWeekIndex = plan.weeks.reduce(
    (max, week) => (week.weekIndex > max ? week.weekIndex : max),
    0
  );
  return Math.max(plan.weekCount || 0, maxWeekIndex);
}

function computeWeekBounds(raceSunday, totalWeeks, weekIndex) {
  const weeksFromEnd = totalWeeks - weekIndex;
  const endDate = new Date(raceSunday);
  endDate.setDate(endDate.getDate() - weeksFromEnd * 7);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  return { startDate, endDate };
}

async function alignPlanWeeks(plan, apply) {
  const totalWeeks = resolveTotalWeeks(plan);
  if (totalWeeks <= 0) {
    return { updatedRows: 0, totalWeeks: 0, skipped: true, reason: 'no_weeks' };
  }
  if (!plan.raceDate) {
    return { updatedRows: 0, totalWeeks, skipped: true, reason: 'no_race_date' };
  }

  const raceSunday = getRaceWeekSunday(plan.raceDate);
  let updatedRows = 0;

  for (let weekIndex = 1; weekIndex <= totalWeeks; weekIndex += 1) {
    const { startDate, endDate } = computeWeekBounds(raceSunday, totalWeeks, weekIndex);

    if (apply) {
      const result = await prisma.planWeek.updateMany({
        where: { planId: plan.id, weekIndex },
        data: { startDate, endDate }
      });
      updatedRows += result.count;
    }
  }

  return { updatedRows, totalWeeks, skipped: false, reason: null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const where = {
    isTemplate: false,
    ...(args.planId ? { id: args.planId } : {}),
    ...(args.athleteId ? { athleteId: args.athleteId } : {})
  };

  const plans = await prisma.trainingPlan.findMany({
    where,
    select: {
      id: true,
      name: true,
      raceDate: true,
      weekCount: true,
      athleteId: true,
      weeks: {
        select: { weekIndex: true },
        orderBy: { weekIndex: 'asc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (plans.length === 0) {
    console.log('No plans found for the provided filters.');
    return;
  }

  console.log(
    `${args.apply ? 'APPLY' : 'DRY RUN'}: evaluating ${plans.length} plan(s) for week-date alignment`
  );

  let alignedPlans = 0;
  let skippedNoRace = 0;
  let skippedNoWeeks = 0;
  let updatedRowsTotal = 0;

  for (const plan of plans) {
    const result = await alignPlanWeeks(plan, args.apply);
    if (result.skipped) {
      if (result.reason === 'no_race_date') skippedNoRace += 1;
      if (result.reason === 'no_weeks') skippedNoWeeks += 1;
      console.log(
        `- ${plan.id} (${plan.name}): skipped (${result.reason === 'no_race_date' ? 'no raceDate' : 'no weeks'})`
      );
      continue;
    }

    alignedPlans += 1;
    updatedRowsTotal += result.updatedRows;
    const raceDateLabel = startOfDay(plan.raceDate).toISOString().slice(0, 10);
    console.log(
      `- ${plan.id} (${plan.name}): aligned ${result.totalWeeks} week(s) from raceDate ${raceDateLabel}`
    );
  }

  console.log('');
  console.log('Summary');
  console.log(`- plans scanned: ${plans.length}`);
  console.log(`- plans aligned: ${alignedPlans}`);
  console.log(`- skipped (no raceDate): ${skippedNoRace}`);
  console.log(`- skipped (no weeks): ${skippedNoWeeks}`);
  console.log(`- week rows updated: ${args.apply ? updatedRowsTotal : 0}`);
  console.log(`- mode: ${args.apply ? 'applied' : 'dry-run only (no writes)'}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
