-- CreateTable
CREATE TABLE "PlanImage" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanImage_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "TrainingPlan" ADD COLUMN "bannerImageId" TEXT;

-- CreateIndex
CREATE INDEX "PlanImage_planId_createdAt_idx" ON "PlanImage"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "TrainingPlan_bannerImageId_idx" ON "TrainingPlan"("bannerImageId");

-- AddForeignKey
ALTER TABLE "PlanImage"
ADD CONSTRAINT "PlanImage_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan"
ADD CONSTRAINT "TrainingPlan_bannerImageId_fkey"
FOREIGN KEY ("bannerImageId") REFERENCES "PlanImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
