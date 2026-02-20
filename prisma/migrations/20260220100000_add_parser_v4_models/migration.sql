-- CreateEnum
CREATE TYPE "ParseJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "ParseJob" (
    "id" TEXT NOT NULL,
    "planId" TEXT,
    "parserVersion" TEXT NOT NULL,
    "status" "ParseJobStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParseJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParseArtifact" (
    "id" TEXT NOT NULL,
    "parseJobId" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "json" JSONB NOT NULL,
    "validationOk" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParseArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParseJob_planId_idx" ON "ParseJob"("planId");

-- CreateIndex
CREATE INDEX "ParseJob_createdAt_idx" ON "ParseJob"("createdAt");

-- CreateIndex
CREATE INDEX "ParseArtifact_parseJobId_idx" ON "ParseArtifact"("parseJobId");

-- AddForeignKey
ALTER TABLE "ParseJob" ADD CONSTRAINT "ParseJob_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParseArtifact" ADD CONSTRAINT "ParseArtifact_parseJobId_fkey" FOREIGN KEY ("parseJobId") REFERENCES "ParseJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
