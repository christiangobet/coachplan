ALTER TABLE "PlanChangeLog"
ADD COLUMN "patchId" TEXT;

CREATE INDEX "PlanChangeLog_planId_patchId_idx"
ON "PlanChangeLog"("planId", "patchId");
