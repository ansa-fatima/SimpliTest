-- Manual drag-and-drop ordering for portals, modules, suites (features), and
-- test cases. Each new column defaults to 0, so it's backfilled below from
-- each table's current default display order (grouped by sibling parent),
-- meaning nothing visually reshuffles until a user actually drags something.

ALTER TABLE "portals" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "modules" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "features" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "test_cases" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- Portals: sibling group = project, current default order = createdAt asc.
UPDATE "portals" p
SET "order" = sub.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "createdAt" ASC) - 1 AS rn
  FROM "portals"
) sub
WHERE p."id" = sub."id";

-- Modules: sibling group = portal, current default order = name asc.
UPDATE "modules" m
SET "order" = sub.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "portalId" ORDER BY "name" ASC) - 1 AS rn
  FROM "modules"
) sub
WHERE m."id" = sub."id";

-- Suites: sibling group = (module, parent suite) -- NULL parentId groups
-- together as the module's root suites, which is exactly the grouping we
-- want. Current default order = name asc.
UPDATE "features" f
SET "order" = sub.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "moduleId", "parentId" ORDER BY "name" ASC) - 1 AS rn
  FROM "features"
) sub
WHERE f."id" = sub."id";

-- Test cases: sibling group = whichever of portal/module/suite the case is
-- attached to (exactly one is set). Current default order = caseNum desc.
UPDATE "test_cases" tc
SET "order" = sub.rn
FROM (
  SELECT "id",
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE("portalId", "moduleId", "featureId")
      ORDER BY "caseNum" DESC
    ) - 1 AS rn
  FROM "test_cases"
) sub
WHERE tc."id" = sub."id";
