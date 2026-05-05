CREATE TABLE "RosterForecastSnapshot" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "source" TEXT,
    "targetWagePercent" DOUBLE PRECISION NOT NULL,
    "forecastSalesCents" INTEGER NOT NULL,
    "wageBudgetCents" INTEGER NOT NULL,
    "rosterCostCents" INTEGER NOT NULL,
    "plannedHours" DOUBLE PRECISION NOT NULL,
    "recommendedHours" DOUBLE PRECISION NOT NULL,
    "dailySalesCents" JSONB NOT NULL,
    "venueBreakdown" JSONB NOT NULL,
    "areaBreakdown" JSONB NOT NULL,
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterForecastSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RosterForecastSnapshot_weekStart_weekEnd_venue_key" ON "RosterForecastSnapshot"("weekStart", "weekEnd", "venue");
CREATE INDEX "RosterForecastSnapshot_weekStart_weekEnd_idx" ON "RosterForecastSnapshot"("weekStart", "weekEnd");
CREATE INDEX "RosterForecastSnapshot_venue_weekStart_idx" ON "RosterForecastSnapshot"("venue", "weekStart");
