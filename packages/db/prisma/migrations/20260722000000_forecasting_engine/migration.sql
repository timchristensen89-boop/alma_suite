-- Forecasting engine: per-day forecast snapshots (accuracy tracking by lead
-- time) and the singleton cash-flow assumptions config.

CREATE TABLE "ForecastDaySnapshot" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "forecastDate" TIMESTAMP(3) NOT NULL,
    "leadDays" INTEGER NOT NULL,
    "coversForecast" INTEGER NOT NULL DEFAULT 0,
    "salesForecastCents" INTEGER NOT NULL DEFAULT 0,
    "wagesForecastCents" INTEGER NOT NULL DEFAULT 0,
    "cogsForecastCents" INTEGER NOT NULL DEFAULT 0,
    "method" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastDaySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ForecastDaySnapshot_venue_forecastDate_leadDays_key" ON "ForecastDaySnapshot"("venue", "forecastDate", "leadDays");
CREATE INDEX "ForecastDaySnapshot_forecastDate_idx" ON "ForecastDaySnapshot"("forecastDate");
CREATE INDEX "ForecastDaySnapshot_venue_forecastDate_idx" ON "ForecastDaySnapshot"("venue", "forecastDate");

CREATE TABLE "ForecastConfig" (
    "id" TEXT NOT NULL,
    "openingBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "openingBalanceDate" TIMESTAMP(3),
    "supplierPaymentLagDays" INTEGER NOT NULL DEFAULT 21,
    "cardSettlementLagDays" INTEGER NOT NULL DEFAULT 1,
    "payrollFrequency" TEXT NOT NULL DEFAULT 'WEEKLY',
    "payrollPayWeekday" INTEGER NOT NULL DEFAULT 3,
    "payrollAnchorDate" TIMESTAMP(3),
    "fixedCosts" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastConfig_pkey" PRIMARY KEY ("id")
);
