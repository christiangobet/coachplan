-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('STRAVA', 'GARMIN');

-- CreateTable
CREATE TABLE "ExternalAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "providerUserId" TEXT,
    "providerUsername" TEXT,
    "tokenType" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "scopes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "syncCursor" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalActivity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "providerActivityId" TEXT NOT NULL,
    "name" TEXT,
    "sportType" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER,
    "movingTimeSec" INTEGER,
    "elapsedTimeSec" INTEGER,
    "distanceM" DOUBLE PRECISION,
    "avgHeartRate" INTEGER,
    "maxHeartRate" INTEGER,
    "calories" DOUBLE PRECISION,
    "avgPaceSecPerKm" DOUBLE PRECISION,
    "raw" JSONB,
    "matchedPlanActivityId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAccount_userId_provider_key" ON "ExternalAccount"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAccount_provider_providerUserId_key" ON "ExternalAccount"("provider", "providerUserId");

-- CreateIndex
CREATE INDEX "ExternalAccount_userId_provider_idx" ON "ExternalAccount"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalActivity_provider_providerActivityId_key" ON "ExternalActivity"("provider", "providerActivityId");

-- CreateIndex
CREATE INDEX "ExternalActivity_userId_startTime_idx" ON "ExternalActivity"("userId", "startTime");

-- CreateIndex
CREATE INDEX "ExternalActivity_accountId_startTime_idx" ON "ExternalActivity"("accountId", "startTime");

-- CreateIndex
CREATE INDEX "ExternalActivity_matchedPlanActivityId_idx" ON "ExternalActivity"("matchedPlanActivityId");

-- AddForeignKey
ALTER TABLE "ExternalAccount" ADD CONSTRAINT "ExternalAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalActivity" ADD CONSTRAINT "ExternalActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalActivity" ADD CONSTRAINT "ExternalActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalActivity" ADD CONSTRAINT "ExternalActivity_matchedPlanActivityId_fkey" FOREIGN KEY ("matchedPlanActivityId") REFERENCES "PlanActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
