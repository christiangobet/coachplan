CREATE TYPE "PaceTargetMode" AS ENUM ('SYMBOLIC', 'NUMERIC', 'RANGE', 'HYBRID', 'UNKNOWN');
CREATE TYPE "PaceTargetBucket" AS ENUM ('RECOVERY', 'EASY', 'LONG', 'RACE', 'TEMPO', 'THRESHOLD', 'INTERVAL');
CREATE TYPE "EffortTargetType" AS ENUM ('RPE', 'HR_ZONE', 'HR_BPM', 'TEXT');

ALTER TABLE "PlanActivity"
ADD COLUMN "paceTargetMode" "PaceTargetMode",
ADD COLUMN "paceTargetBucket" "PaceTargetBucket",
ADD COLUMN "paceTargetMinSec" DOUBLE PRECISION,
ADD COLUMN "paceTargetMaxSec" DOUBLE PRECISION,
ADD COLUMN "paceTargetUnit" "Units",
ADD COLUMN "effortTargetType" "EffortTargetType",
ADD COLUMN "effortTargetMin" DOUBLE PRECISION,
ADD COLUMN "effortTargetMax" DOUBLE PRECISION,
ADD COLUMN "effortTargetZone" INTEGER,
ADD COLUMN "effortTargetBpmMin" INTEGER,
ADD COLUMN "effortTargetBpmMax" INTEGER;
