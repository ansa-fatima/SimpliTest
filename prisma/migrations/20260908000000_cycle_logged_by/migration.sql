-- Tracks who logged a quick log, so the Reports Tester filter can narrow
-- quick logs the same way it already narrows test runs (TestRun.executedBy).
-- Existing rows have no record of who logged them and stay blank -- this
-- starts attribution from here going forward, same as wasEverIssue did for
-- retest tracking.

ALTER TABLE "test_cycles" ADD COLUMN "loggedBy" TEXT NOT NULL DEFAULT '';
