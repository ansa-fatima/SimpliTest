-- Quick-log entries can be back-dated to the day they were actually executed —
-- distinct from createdAt (when typed into the system).
ALTER TABLE "test_cycles" ADD COLUMN "completedAt" TIMESTAMP(3);
