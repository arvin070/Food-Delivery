-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'PICKED_UP';

-- AlterEnum
ALTER TYPE "OrderItemStatus" ADD VALUE 'PICKED_UP';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeliveryStatus" ADD VALUE 'ASSIGNED';
ALTER TYPE "DeliveryStatus" ADD VALUE 'PICKED_UP';

-- AlterTable
ALTER TABLE "delivery_runs" ADD COLUMN     "departedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "otpIssuedAt" TIMESTAMP(3),
ADD COLUMN     "outForDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "pickedUpAt" TIMESTAMP(3),
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

