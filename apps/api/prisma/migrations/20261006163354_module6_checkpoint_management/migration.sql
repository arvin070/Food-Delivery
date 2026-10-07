-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CheckpointType" ADD VALUE 'COMMUNITY_POINT';
ALTER TYPE "CheckpointType" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "checkpoints" ADD COLUMN     "deliveryCapacity" INTEGER;

-- CreateIndex
CREATE INDEX "checkpoints_type_isActive_idx" ON "checkpoints"("type", "isActive");
