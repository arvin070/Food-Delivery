-- CreateTable
CREATE TABLE "kitchen_staff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kitchenId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kitchen_staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kitchen_staff_kitchenId_idx" ON "kitchen_staff"("kitchenId");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_staff_userId_kitchenId_key" ON "kitchen_staff"("userId", "kitchenId");

-- AddForeignKey
ALTER TABLE "kitchen_staff" ADD CONSTRAINT "kitchen_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_staff" ADD CONSTRAINT "kitchen_staff_kitchenId_fkey" FOREIGN KEY ("kitchenId") REFERENCES "kitchens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

