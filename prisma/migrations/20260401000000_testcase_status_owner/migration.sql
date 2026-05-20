-- Adds Active/Draft/Archived status + optional owner (user) to TestCase.

-- 1. CaseStatus enum
CREATE TYPE "CaseStatus" AS ENUM ('Active', 'Draft', 'Archived');

-- 2. status column on test_cases (default Active so existing rows are visible)
ALTER TABLE "test_cases"
    ADD COLUMN "status" "CaseStatus" NOT NULL DEFAULT 'Active';

CREATE INDEX "test_cases_status_idx" ON "test_cases"("status");

-- 3. ownerId column on test_cases (nullable — case may be unassigned)
ALTER TABLE "test_cases"
    ADD COLUMN "ownerId" TEXT;

CREATE INDEX "test_cases_ownerId_idx" ON "test_cases"("ownerId");

ALTER TABLE "test_cases"
    ADD CONSTRAINT "test_cases_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
