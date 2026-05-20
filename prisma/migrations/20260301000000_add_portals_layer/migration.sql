-- Inserts a Portal layer between Project and Module.
-- For every existing project we create a "Main" portal and re-parent that
-- project's modules underneath it, so no data is lost.

-- ─── 1. Create portals table ─────────────────────────────────
CREATE TABLE "portals" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "slug"      TEXT,
    "icon"      TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "portals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "portals_projectId_idx" ON "portals"("projectId");
CREATE UNIQUE INDEX "portals_projectId_name_key" ON "portals"("projectId", "name");

ALTER TABLE "portals"
    ADD CONSTRAINT "portals_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2. Seed a "Main" portal per existing project ────────────
INSERT INTO "portals" ("id", "name", "slug", "projectId", "updatedAt")
SELECT
    'pt_' || substr(md5(p."id" || '_main'), 1, 24) AS id,
    'Main'                                          AS name,
    'main'                                          AS slug,
    p."id"                                          AS "projectId",
    CURRENT_TIMESTAMP                               AS "updatedAt"
FROM "projects" p
ON CONFLICT DO NOTHING;

-- ─── 3. Add Module.portalId, backfill from project's Main portal ─
ALTER TABLE "modules" ADD COLUMN "portalId" TEXT;

UPDATE "modules" m
SET "portalId" = (
    SELECT pt."id" FROM "portals" pt
    WHERE pt."projectId" = m."projectId" AND pt."name" = 'Main'
    LIMIT 1
);

ALTER TABLE "modules" ALTER COLUMN "portalId" SET NOT NULL;

CREATE INDEX "modules_portalId_idx" ON "modules"("portalId");

ALTER TABLE "modules"
    ADD CONSTRAINT "modules_portalId_fkey"
    FOREIGN KEY ("portalId") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 4. Replace Module unique constraint (project,name) → (portal,name) ─
DROP INDEX IF EXISTS "modules_projectId_name_key";
CREATE UNIQUE INDEX "modules_portalId_name_key" ON "modules"("portalId", "name");

-- ─── 5. Drop Module.projectId (now derivable via portal → project) ───
ALTER TABLE "modules" DROP CONSTRAINT IF EXISTS "modules_projectId_fkey";
DROP INDEX IF EXISTS "modules_projectId_idx";
ALTER TABLE "modules" DROP COLUMN "projectId";
