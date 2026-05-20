-- Adds the Project hierarchy layer and renames CycleScopeType.Feature → Suite.
-- The `features` table is kept (Prisma model is now Suite via @@map), so no
-- table-rename SQL is needed here.

-- ─── 1. Create projects table ────────────────────────────────
CREATE TABLE "projects" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "slug"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "projects_name_key" ON "projects"("name");
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- ─── 2. Seed a Default project to backfill orphan rows ──────
INSERT INTO "projects" ("id", "name", "slug", "updatedAt")
VALUES ('clp_default0000000000000000', 'Default', 'default', CURRENT_TIMESTAMP);

-- ─── 3. Add Module.projectId (NOT NULL via backfill) ─────────
ALTER TABLE "modules" ADD COLUMN "projectId" TEXT;
UPDATE "modules" SET "projectId" = 'clp_default0000000000000000' WHERE "projectId" IS NULL;
ALTER TABLE "modules" ALTER COLUMN "projectId" SET NOT NULL;

ALTER TABLE "modules"
    ADD CONSTRAINT "modules_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "modules_projectId_idx" ON "modules"("projectId");

-- Replace global unique-on-name with composite unique-on-(project, name)
DROP INDEX IF EXISTS "modules_name_key";
CREATE UNIQUE INDEX "modules_projectId_name_key" ON "modules"("projectId", "name");

-- ─── 4. Add TestCycle.projectId (NOT NULL via backfill) ─────
ALTER TABLE "test_cycles" ADD COLUMN "projectId" TEXT;
UPDATE "test_cycles" SET "projectId" = 'clp_default0000000000000000' WHERE "projectId" IS NULL;
ALTER TABLE "test_cycles" ALTER COLUMN "projectId" SET NOT NULL;

ALTER TABLE "test_cycles"
    ADD CONSTRAINT "test_cycles_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "test_cycles_projectId_idx" ON "test_cycles"("projectId");

-- ─── 5. Rename CycleScopeType enum value 'Feature' → 'Suite' ─
ALTER TYPE "CycleScopeType" RENAME VALUE 'Feature' TO 'Suite';
