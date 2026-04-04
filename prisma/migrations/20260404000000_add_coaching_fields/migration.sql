-- AlterTable: add coachingNote and sessionFocus to PlanActivity
ALTER TABLE "PlanActivity" ADD COLUMN IF NOT EXISTS "coachingNote" TEXT;
ALTER TABLE "PlanActivity" ADD COLUMN IF NOT EXISTS "sessionFocus" TEXT;

-- AlterTable: add coachBrief to PlanWeek
ALTER TABLE "PlanWeek" ADD COLUMN IF NOT EXISTS "coachBrief" TEXT;
