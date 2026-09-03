-- Tracks whether a test run has ever been marked Failed or Blocked, so the
-- Retest widget can tell "retested and fixed" apart from "passed on the
-- first try" -- the bare `result` column alone only knows the current
-- state. Backfilled from current data: any run that's Failed or Blocked
-- right now obviously counts; anything already Passed before this migration
-- starts as false (untracked history), which just means retest tracking
-- begins from here going forward rather than retroactively.

ALTER TABLE "test_runs" ADD COLUMN "wasEverIssue" BOOLEAN NOT NULL DEFAULT false;

UPDATE "test_runs"
SET "wasEverIssue" = true
WHERE "result" IN ('Failed', 'Blocked');
