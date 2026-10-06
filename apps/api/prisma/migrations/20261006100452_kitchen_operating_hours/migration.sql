-- CreateTable
CREATE TABLE "kitchen_operating_hours" (
    "id" TEXT NOT NULL,
    "kitchenId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "opensMinute" INTEGER NOT NULL DEFAULT 360,
    "closesMinute" INTEGER NOT NULL DEFAULT 1320,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_operating_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_operating_hours_kitchenId_dayOfWeek_key" ON "kitchen_operating_hours"("kitchenId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "kitchen_operating_hours" ADD CONSTRAINT "kitchen_operating_hours_kitchenId_fkey" FOREIGN KEY ("kitchenId") REFERENCES "kitchens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
