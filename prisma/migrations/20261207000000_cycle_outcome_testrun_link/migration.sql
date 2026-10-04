-- Adds the two fields the Testing Cycles form introduces on top of the quick
-- log: an explicit per-cycle outcome (Open/Pass/Fail) and a separate test-run
-- URL (distinct from the Jira ticketLink). Both nullable so existing rows are
-- untouched -- the UI derives a display outcome from the counts when this is
-- null, so historical quick logs read correctly without a backfill.

ALTER TABLE "test_cycles" ADD COLUMN "outcome" TEXT;
ALTER TABLE "test_cycles" ADD COLUMN "testRunLink" TEXT;
