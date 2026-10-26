-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billingMode" TEXT NOT NULL DEFAULT 'PER_ORDER',
ADD COLUMN     "billingProvider" TEXT,
ADD COLUMN     "billingReference" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'CUSTOM';

-- CreateTable
CREATE TABLE "subscription_skips" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,

    CONSTRAINT "subscription_skips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "serviceDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_holidays" (
    "id" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "cityId" TEXT,
    "name" TEXT NOT NULL,

    CONSTRAINT "service_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_skips_subscriptionId_serviceDate_key" ON "subscription_skips"("subscriptionId", "serviceDate");

-- CreateIndex
CREATE INDEX "subscription_events_subscriptionId_createdAt_idx" ON "subscription_events"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "service_holidays_serviceDate_cityId_idx" ON "service_holidays"("serviceDate", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_subscriptionId_serviceDate_key" ON "order_items"("subscriptionId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_idempotencyKey_key" ON "subscriptions"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "subscription_skips" ADD CONSTRAINT "subscription_skips_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

