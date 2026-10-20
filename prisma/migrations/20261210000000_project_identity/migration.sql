-- AlterTable: Settings > General "Project identity" -- description, colour,
-- icon, short key and visibility. Everything has a default or is nullable so
-- existing workspaces keep working without a backfill.
ALTER TABLE "projects"
    ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "color" TEXT,
    ADD COLUMN "icon" TEXT,
    ADD COLUMN "caseKey" TEXT,
    ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'Internal';
