-- CreateEnum
CREATE TYPE "InstitutionBulkRequestStatus" AS ENUM ('REQUESTED', 'REVIEWING', 'CLOSED');

-- AlterEnum
ALTER TYPE "InstitutionType" ADD VALUE 'UNIVERSITY';

-- AlterTable
ALTER TABLE "institutions" ADD COLUMN     "deliveryNotes" TEXT,
ADD COLUMN     "registrationOpen" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "time_slots" ADD COLUMN     "institutionId" TEXT;

-- CreateTable
CREATE TABLE "institution_bulk_requests" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "quantityPerDay" INTEGER NOT NULL,
    "mealPeriod" "MealPeriod" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "notes" TEXT,
    "status" "InstitutionBulkRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institution_bulk_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "institution_bulk_requests_institutionId_createdAt_idx" ON "institution_bulk_requests"("institutionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "institution_bulk_requests_institutionId_idempotencyKey_key" ON "institution_bulk_requests"("institutionId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "time_slots" ADD CONSTRAINT "time_slots_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institution_bulk_requests" ADD CONSTRAINT "institution_bulk_requests_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institution_bulk_requests" ADD CONSTRAINT "institution_bulk_requests_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

