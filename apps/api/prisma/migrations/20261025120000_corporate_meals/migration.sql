-- CreateEnum
CREATE TYPE "CorporateAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CorporateMemberRole" AS ENUM ('ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "CorporateChargeStatus" AS ENUM ('AUTHORIZED', 'RELEASED', 'INVOICED', 'SETTLED');

-- CreateTable
CREATE TABLE "corporate_accounts" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "status" "CorporateAccountStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "creditLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monthlyBudget" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employeeMonthlyCredit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subsidyPerMeal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "maxMealsPerDay" INTEGER NOT NULL DEFAULT 1,
    "allowedWeekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "allowedPeriods" "MealPeriod"[] DEFAULT ARRAY['LUNCH']::"MealPeriod"[],
    "allowCopayment" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corporate_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_members" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CorporateMemberRole" NOT NULL DEFAULT 'EMPLOYEE',
    "employeeNumber" TEXT,
    "monthlyCredit" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corporate_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_order_batches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corporate_order_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_charges" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "month" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "companyAmount" DECIMAL(12,2) NOT NULL,
    "employeeAmount" DECIMAL(12,2) NOT NULL,
    "status" "CorporateChargeStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "policySnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corporate_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "settlementReference" TEXT,
    "settledByUserId" TEXT,

    CONSTRAINT "corporate_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "corporate_accounts_institutionId_key" ON "corporate_accounts"("institutionId");

-- CreateIndex
CREATE INDEX "corporate_members_userId_isActive_idx" ON "corporate_members"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_members_companyId_userId_key" ON "corporate_members"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_order_batches_companyId_idempotencyKey_key" ON "corporate_order_batches"("companyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_charges_orderId_key" ON "corporate_charges"("orderId");

-- CreateIndex
CREATE INDEX "corporate_charges_companyId_month_status_idx" ON "corporate_charges"("companyId", "month", "status");

-- CreateIndex
CREATE INDEX "corporate_charges_memberId_serviceDate_status_idx" ON "corporate_charges"("memberId", "serviceDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_invoices_number_key" ON "corporate_invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_invoices_settlementReference_key" ON "corporate_invoices"("settlementReference");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_invoices_companyId_month_key" ON "corporate_invoices"("companyId", "month");

-- AddForeignKey
ALTER TABLE "corporate_accounts" ADD CONSTRAINT "corporate_accounts_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_members" ADD CONSTRAINT "corporate_members_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "corporate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_members" ADD CONSTRAINT "corporate_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_order_batches" ADD CONSTRAINT "corporate_order_batches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "corporate_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_charges" ADD CONSTRAINT "corporate_charges_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "corporate_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_charges" ADD CONSTRAINT "corporate_charges_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "corporate_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_charges" ADD CONSTRAINT "corporate_charges_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_charges" ADD CONSTRAINT "corporate_charges_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "corporate_order_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_charges" ADD CONSTRAINT "corporate_charges_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "corporate_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_invoices" ADD CONSTRAINT "corporate_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "corporate_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

