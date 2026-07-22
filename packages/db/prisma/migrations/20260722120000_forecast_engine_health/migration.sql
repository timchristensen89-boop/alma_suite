-- Engine-health fields on the forecast config singleton: the nightly snapshot
-- job stamps its last run + data-quality warnings so notifications can alert
-- on a stalled engine or degraded inputs without recomputing the forecast.

ALTER TABLE "ForecastConfig" ADD COLUMN "lastRunAt" TIMESTAMP(3);
ALTER TABLE "ForecastConfig" ADD COLUMN "lastWarnings" JSONB NOT NULL DEFAULT '[]';
