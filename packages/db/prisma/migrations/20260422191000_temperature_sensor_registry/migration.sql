-- CreateTable
CREATE TABLE "TemperatureIntegration" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "apiKeyHint" TEXT,
    "baseUrl" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemperatureIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemperatureSensor" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "externalSensorId" TEXT NOT NULL,
    "externalName" TEXT,
    "externalModel" TEXT,
    "assetId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastTemperature" DOUBLE PRECISION,
    "lastBatteryLevel" INTEGER,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemperatureSensor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemperatureIntegration_provider_key" ON "TemperatureIntegration"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "TemperatureSensor_integrationId_externalSensorId_key" ON "TemperatureSensor"("integrationId", "externalSensorId");

-- CreateIndex
CREATE INDEX "TemperatureSensor_integrationId_externalSensorId_idx" ON "TemperatureSensor"("integrationId", "externalSensorId");

-- AddForeignKey
ALTER TABLE "TemperatureSensor" ADD CONSTRAINT "TemperatureSensor_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "TemperatureIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemperatureSensor" ADD CONSTRAINT "TemperatureSensor_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "TemperatureAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
