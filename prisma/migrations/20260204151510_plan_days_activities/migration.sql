/*
  Warnings:

  - You are about to drop the `PlanWorkout` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('RUN', 'STRENGTH', 'CROSS_TRAIN', 'REST', 'MOBILITY', 'YOGA', 'HIKE', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityPriority" AS ENUM ('KEY', 'MEDIUM', 'OPTIONAL');

-- DropForeignKey
ALTER TABLE "PlanWorkout" DROP CONSTRAINT "PlanWorkout_planId_fkey";

-- DropForeignKey
ALTER TABLE "PlanWorkout" DROP CONSTRAINT "PlanWorkout_weekId_fkey";

-- DropTable
DROP TABLE "PlanWorkout";

-- CreateTable
CREATE TABLE "PlanDay" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "rawText" TEXT,
    "notes" TEXT,

    CONSTRAINT "PlanDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanActivity" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL DEFAULT 'OTHER',
    "subtype" TEXT,
    "title" TEXT NOT NULL,
    "rawText" TEXT,
    "distance" DOUBLE PRECISION,
    "distanceUnit" "Units",
    "duration" INTEGER,
    "paceTarget" TEXT,
    "effortTarget" TEXT,
    "structure" JSONB,
    "tags" JSONB,
    "priority" "ActivityPriority",
    "bailAllowed" BOOLEAN NOT NULL DEFAULT false,
    "mustDo" BOOLEAN NOT NULL DEFAULT false,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "actualDistance" DOUBLE PRECISION,
    "actualDuration" INTEGER,
    "notes" TEXT,

    CONSTRAINT "PlanActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanDay_weekId_dayOfWeek_key" ON "PlanDay"("weekId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "PlanDay" ADD CONSTRAINT "PlanDay_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanDay" ADD CONSTRAINT "PlanDay_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "PlanWeek"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanActivity" ADD CONSTRAINT "PlanActivity_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanActivity" ADD CONSTRAINT "PlanActivity_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "PlanDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
