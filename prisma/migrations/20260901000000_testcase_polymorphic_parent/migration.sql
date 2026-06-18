-- Allow a test case to attach directly to a Portal, Module, or Suite.
-- Step 1: add the new optional FK columns + indexes.
-- Step 2: make existing suiteId nullable.
-- Step 3: backfill — move every test case currently in a "General"-named suite
--         up to its module, then delete those empty "General" suites.
-- Step 4: add FK constraints for portalId / moduleId.

-- ── 1. New columns ─────────────────────────────────────────
ALTER TABLE "test_cases" ADD COLUMN "portalId" TEXT;
ALTER TABLE "test_cases" ADD COLUMN "moduleId" TEXT;

CREATE INDEX "test_cases_portalId_idx" ON "test_cases"("portalId");
CREATE INDEX "test_cases_moduleId_idx" ON "test_cases"("moduleId");

-- ── 2. Make featureId (suiteId) nullable ───────────────────
ALTER TABLE "test_cases" ALTER COLUMN "featureId" DROP NOT NULL;

-- ── 3. Backfill: collapse "General" placeholder suites ─────
-- Move cases from any suite named "General" up to that suite's module,
-- then delete those (now-empty) suites. Idempotent — re-running is a no-op
-- because the suites won't exist on the second run.
UPDATE "test_cases" tc
SET "moduleId" = f."moduleId",
    "featureId" = NULL
FROM "features" f
WHERE tc."featureId" = f."id"
  AND f."name" = 'General'
  AND f."parentId" IS NULL;

DELETE FROM "features"
WHERE "name" = 'General'
  AND "parentId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "test_cases" tc WHERE tc."featureId" = "features"."id")
  AND NOT EXISTS (SELECT 1 FROM "features" c WHERE c."parentId" = "features"."id");

-- ── 4. FK constraints for portalId / moduleId ──────────────
ALTER TABLE "test_cases"
  ADD CONSTRAINT "test_cases_portalId_fkey"
  FOREIGN KEY ("portalId") REFERENCES "portals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "test_cases"
  ADD CONSTRAINT "test_cases_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "modules"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
