CREATE TABLE "delivery_run_tracking" (
  "deliveryRunId" TEXT PRIMARY KEY,
  "deliveryPartnerId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "accuracy" DOUBLE PRECISION,
  "observedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "etaStopId" TEXT,
  "estimatedArrivalAt" TIMESTAMP(3),
  "etaReportedAt" TIMESTAMP(3),
  CONSTRAINT "delivery_run_tracking_deliveryRunId_fkey" FOREIGN KEY ("deliveryRunId") REFERENCES "delivery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tracking_coordinates" CHECK (("latitude" IS NULL AND "longitude" IS NULL AND "accuracy" IS NULL) OR
    ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180 AND "accuracy" BETWEEN 0 AND 1000))
);
CREATE INDEX "delivery_run_tracking_expiresAt_idx" ON "delivery_run_tracking"("expiresAt");
