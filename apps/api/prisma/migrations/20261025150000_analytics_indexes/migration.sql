-- CreateIndex
CREATE INDEX "orders_placedAt_idx" ON "orders"("placedAt");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX "order_items_serviceDate_idx" ON "order_items"("serviceDate");

-- CreateIndex
CREATE INDEX "payments_paidAt_idx" ON "payments"("paidAt");

-- CreateIndex
CREATE INDEX "refunds_processedAt_idx" ON "refunds"("processedAt");

-- CreateIndex
CREATE INDEX "corporate_invoices_settledAt_idx" ON "corporate_invoices"("settledAt");

