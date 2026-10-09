-- CreateTable: QA Portal · Module · Feature taxonomy (separate from the
-- test-case Portal > Module > Suite tree). Powers the Stability page's
-- module ordering and the New-cycle form's cascading dropdowns.
CREATE TABLE "qa_portals" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_portals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "qa_portals_projectId_idx" ON "qa_portals"("projectId");
CREATE UNIQUE INDEX "qa_portals_projectId_name_key" ON "qa_portals"("projectId", "name");

ALTER TABLE "qa_portals"
    ADD CONSTRAINT "qa_portals_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "qa_modules" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_modules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "qa_modules_portalId_idx" ON "qa_modules"("portalId");
CREATE UNIQUE INDEX "qa_modules_portalId_name_key" ON "qa_modules"("portalId", "name");

ALTER TABLE "qa_modules"
    ADD CONSTRAINT "qa_modules_portalId_fkey"
    FOREIGN KEY ("portalId") REFERENCES "qa_portals"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "qa_features" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_features_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "qa_features_moduleId_idx" ON "qa_features"("moduleId");
CREATE UNIQUE INDEX "qa_features_moduleId_name_key" ON "qa_features"("moduleId", "name");

ALTER TABLE "qa_features"
    ADD CONSTRAINT "qa_features_moduleId_fkey"
    FOREIGN KEY ("moduleId") REFERENCES "qa_modules"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Jira auto-sync preferences + last-sync status. Defaults
-- mirror what the Settings UI shows on a fresh connection: 15 minutes,
-- auto-sync on.
ALTER TABLE "jira_connections"
    ADD COLUMN "autoSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    ADD COLUMN "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "lastSyncAt" TIMESTAMP(3),
    ADD COLUMN "lastSyncCount" INTEGER;
