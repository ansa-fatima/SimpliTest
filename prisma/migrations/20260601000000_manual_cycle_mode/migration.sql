-- Adds a Manual cycle mode (no test cases) with bookkeeping columns matching
-- the team's spreadsheet workflow.

-- 1. CycleMode enum
CREATE TYPE "CycleMode" AS ENUM ('CaseBased', 'Manual');

-- 2. Add columns to test_cycles
ALTER TABLE "test_cycles"
    ADD COLUMN "mode" "CycleMode" NOT NULL DEFAULT 'CaseBased',
    ADD COLUMN "moduleName" TEXT,
    ADD COLUMN "featureName" TEXT,
    ADD COLUMN "environment" TEXT,
    ADD COLUMN "platform" TEXT,
    ADD COLUMN "version" TEXT,
    ADD COLUMN "cycleCategory" TEXT,
    ADD COLUMN "ticketLink" TEXT,
    ADD COLUMN "issueCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "criticalCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "majorCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "minorCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "doneCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "remainingCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "passedCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "failedCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "blockedCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "test_cycles_mode_idx" ON "test_cycles"("mode");
