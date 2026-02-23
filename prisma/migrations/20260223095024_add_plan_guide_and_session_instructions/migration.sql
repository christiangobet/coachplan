-- DropForeignKey
ALTER TABLE "ExternalActivity" DROP CONSTRAINT "ExternalActivity_accountId_fkey";

-- AlterTable
ALTER TABLE "ExternalAccount" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExternalActivity" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PlanActivity" ADD COLUMN     "sessionInstructions" TEXT;

-- AlterTable
ALTER TABLE "TrainingPlan" ADD COLUMN     "planGuide" TEXT;

-- AddForeignKey
ALTER TABLE "ExternalActivity" ADD CONSTRAINT "ExternalActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ExternalAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
