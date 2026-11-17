-- AlterTable: add idempotency_key nullable first so existing rows migrate cleanly
ALTER TABLE "click_events" ADD COLUMN "idempotency_key" TEXT;

-- Backfill existing click_events rows with their unique UUID primary key
UPDATE "click_events" SET "idempotency_key" = "id" WHERE "idempotency_key" IS NULL;

-- Enforce NOT NULL and unique constraint
ALTER TABLE "click_events" ALTER COLUMN "idempotency_key" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "click_events_idempotency_key_key" ON "click_events"("idempotency_key");

