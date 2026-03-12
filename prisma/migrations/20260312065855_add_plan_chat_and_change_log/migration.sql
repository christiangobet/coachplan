-- CreateTable
CREATE TABLE "PlanChatMessage" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanChangeLog" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "activityId" TEXT,
    "fromDayId" TEXT,
    "toDayId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "editSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanChatMessage_planId_createdAt_idx" ON "PlanChatMessage"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanChangeLog_planId_createdAt_idx" ON "PlanChangeLog"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanChangeLog_planId_editSessionId_idx" ON "PlanChangeLog"("planId", "editSessionId");

-- CreateIndex
CREATE INDEX "PlanActivity_planId_idx" ON "PlanActivity"("planId");

-- CreateIndex
CREATE INDEX "PlanActivity_dayId_idx" ON "PlanActivity"("dayId");

-- CreateIndex
CREATE INDEX "PlanDay_planId_idx" ON "PlanDay"("planId");

-- CreateIndex
CREATE INDEX "TrainingPlan_athleteId_status_idx" ON "TrainingPlan"("athleteId", "status");

-- CreateIndex
CREATE INDEX "TrainingPlan_ownerId_status_idx" ON "TrainingPlan"("ownerId", "status");

-- AddForeignKey
ALTER TABLE "PlanChatMessage" ADD CONSTRAINT "PlanChatMessage_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeLog" ADD CONSTRAINT "PlanChangeLog_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
