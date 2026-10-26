ALTER TABLE "checkpoint_time_slots"
  ADD COLUMN "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7],
  ADD COLUMN "preparationBufferMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "travelBufferMinutes" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "checkpoint_schedule_exceptions" (
  "id" TEXT NOT NULL,
  "checkpointId" TEXT NOT NULL,
  "timeSlotId" TEXT,
  "replacementCheckpointId" TEXT,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "checkpoint_schedule_exceptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checkpoint_schedule_exceptions_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "checkpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "checkpoint_schedule_exceptions_timeSlotId_fkey" FOREIGN KEY ("timeSlotId") REFERENCES "time_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "checkpoint_schedule_exceptions_replacementCheckpointId_fkey" FOREIGN KEY ("replacementCheckpointId") REFERENCES "checkpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "checkpoint_schedule_exceptions_date_check" CHECK ("endDate" >= "startDate"),
  CONSTRAINT "checkpoint_schedule_exceptions_reassignment_check" CHECK ("replacementCheckpointId" IS NULL OR "replacementCheckpointId" <> "checkpointId")
);

CREATE INDEX "checkpoint_schedule_exceptions_checkpoint_dates_idx"
  ON "checkpoint_schedule_exceptions"("checkpointId", "startDate", "endDate");
CREATE INDEX "checkpoint_schedule_exceptions_replacementCheckpointId_idx"
  ON "checkpoint_schedule_exceptions"("replacementCheckpointId");