-- AlterTable
ALTER TABLE "delivery_runs" ADD COLUMN     "creationHash" TEXT,
ADD COLUMN     "creationKey" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "delivery_runs_creationKey_key" ON "delivery_runs"("creationKey");

