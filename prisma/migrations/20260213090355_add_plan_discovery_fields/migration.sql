-- CreateEnum
CREATE TYPE "RaceType" AS ENUM ('MARATHON', 'HALF_MARATHON', 'TEN_K', 'FIVE_K', 'ULTRA_50K', 'ULTRA_50MI', 'ULTRA_100K', 'ULTRA_100MI', 'TRAIL');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- AlterTable
ALTER TABLE "TrainingPlan" ADD COLUMN     "description" TEXT,
ADD COLUMN     "difficulty" "Difficulty",
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "raceType" "RaceType",
ADD COLUMN     "sourceId" TEXT;
