-- Add cached Strava-derived performance snapshot on user profile.
ALTER TABLE "User"
ADD COLUMN "performanceSnapshot" JSONB;
