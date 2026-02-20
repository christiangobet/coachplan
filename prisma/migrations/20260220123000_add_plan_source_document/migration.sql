CREATE TABLE "PlanSourceDocument" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "fileSize" INTEGER NOT NULL,
    "checksumSha256" TEXT,
    "pageCount" INTEGER,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanSourceDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanSourceDocument_planId_key" ON "PlanSourceDocument"("planId");
CREATE INDEX "PlanSourceDocument_createdAt_idx" ON "PlanSourceDocument"("createdAt");

ALTER TABLE "PlanSourceDocument"
ADD CONSTRAINT "PlanSourceDocument_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
