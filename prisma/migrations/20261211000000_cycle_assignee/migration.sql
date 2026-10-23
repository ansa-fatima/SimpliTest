-- AlterTable: optional "Assigned tester" on a test run (New run form). Nullable,
-- so existing runs are unaffected; cleared if the user is deleted.
ALTER TABLE "test_cycles" ADD COLUMN "assigneeId" TEXT, ADD COLUMN "startDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "test_cycles_assigneeId_idx" ON "test_cycles"("assigneeId");

-- AddForeignKey
ALTER TABLE "test_cycles" ADD CONSTRAINT "test_cycles_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
