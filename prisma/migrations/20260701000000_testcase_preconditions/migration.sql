-- Promote Preconditions from a description sub-section to its own column.

-- 1. Add the new column with empty default so existing rows aren't broken.
ALTER TABLE "test_cases"
    ADD COLUMN "preconditions" TEXT NOT NULL DEFAULT '';

-- 2. Backfill from the import-time join — any case whose desc contains the
--    "\n\nPreconditions:\n" marker (added by the CSV importer) gets split:
--      • everything before the marker stays in desc
--      • everything after moves into preconditions
--    Cases without the marker are untouched.
UPDATE "test_cases"
SET
    "preconditions" = SUBSTRING("desc" FROM POSITION(E'\n\nPreconditions:\n' IN "desc") + 17),
    "desc"          = SUBSTRING("desc" FROM 1 FOR POSITION(E'\n\nPreconditions:\n' IN "desc") - 1)
WHERE POSITION(E'\n\nPreconditions:\n' IN "desc") > 0;
