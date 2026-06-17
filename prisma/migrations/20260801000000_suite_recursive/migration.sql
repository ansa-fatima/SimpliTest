-- Lets a Suite have a parent Suite so the folder tree can nest to any depth
-- (a -> b -> c -> d -> ...). Existing suites stay at the module-root level
-- (parentId = NULL) so no backfill of test cases is needed.

-- 1. Drop the strict (moduleId, name) unique — siblings inside a sub-folder
--    can now share a name with siblings under a different parent. App-layer
--    enforces no-duplicates-within-the-same-parent.
ALTER TABLE "features"
    DROP CONSTRAINT IF EXISTS "features_moduleId_name_key";
DROP INDEX IF EXISTS "features_moduleId_name_key";

-- 2. Add the self-referential parent column.
ALTER TABLE "features"
    ADD COLUMN "parentId" TEXT;

CREATE INDEX "features_parentId_idx" ON "features"("parentId");

ALTER TABLE "features"
    ADD CONSTRAINT "features_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "features"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
