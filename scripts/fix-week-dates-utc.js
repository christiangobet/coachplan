#!/usr/bin/env node
/**
 * fix-week-dates-utc.js
 *
 * Fixes PlanWeek startDate/endDate values that were stored as local midnight
 * (e.g. 2026-03-08T23:00:00.000Z = midnight CET) instead of UTC midnight
 * (2026-03-09T00:00:00.000Z).
 *
 * Rule:
 *   - UTC hour >= 20 → date was stored as next-day-local midnight → round UP to next UTC midnight
 *   - UTC hour 1–19  → date was stored as prev-day-local midnight → round DOWN to current UTC midnight
 *   - UTC hour == 0  → already correct, skip
 *
 * Usage:
 *   node scripts/fix-week-dates-utc.js           (dry run)
 *   node scripts/fix-week-dates-utc.js --apply   (write to DB)
 *   node scripts/fix-week-dates-utc.js --plan <planId>
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const planIdArg = (() => {
  const idx = process.argv.indexOf('--plan');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

function roundToUtcMidnight(date) {
  const hour = date.getUTCHours();
  if (hour === 0) return null; // already correct
  const fixed = new Date(date);
  if (hour >= 20) {
    // local midnight stored as late UTC = belongs to next UTC day
    fixed.setUTCDate(fixed.getUTCDate() + 1);
  }
  fixed.setUTCHours(0, 0, 0, 0);
  return fixed;
}

async function main() {
  const where = planIdArg ? { planId: planIdArg } : {};
  const weeks = await prisma.planWeek.findMany({ where, select: { id: true, planId: true, weekIndex: true, startDate: true, endDate: true } });

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: scanning ${weeks.length} PlanWeek rows`);

  let fixed = 0;
  for (const week of weeks) {
    const newStart = week.startDate ? roundToUtcMidnight(week.startDate) : null;
    const newEnd = week.endDate ? roundToUtcMidnight(week.endDate) : null;
    if (!newStart && !newEnd) continue;

    console.log(
      `  week ${week.id} (plan ${week.planId} W${week.weekIndex}):` +
      (newStart ? ` start ${week.startDate.toISOString()} → ${newStart.toISOString()}` : '') +
      (newEnd   ? ` end ${week.endDate.toISOString()} → ${newEnd.toISOString()}` : '')
    );

    if (apply) {
      await prisma.planWeek.update({
        where: { id: week.id },
        data: {
          ...(newStart ? { startDate: newStart } : {}),
          ...(newEnd   ? { endDate:   newEnd   } : {}),
        }
      });
    }
    fixed++;
  }

  console.log('');
  console.log(`Rows needing fix: ${fixed}`);
  console.log(`Mode: ${apply ? 'applied' : 'dry-run (no writes)'}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
