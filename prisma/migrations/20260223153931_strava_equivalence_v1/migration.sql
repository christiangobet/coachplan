-- CreateEnum
CREATE TYPE "ActivityEquivalence" AS ENUM ('FULL', 'PARTIAL', 'NONE');

-- AlterTable
ALTER TABLE "ExternalActivity" ADD COLUMN     "elevationGainM" DOUBLE PRECISION,
ADD COLUMN     "equivalence" "ActivityEquivalence",
ADD COLUMN     "equivalenceConfidence" DOUBLE PRECISION,
ADD COLUMN     "equivalenceNote" TEXT,
ADD COLUMN     "equivalenceOverride" "ActivityEquivalence",
ADD COLUMN     "loadRatio" DOUBLE PRECISION;
