-- Track who created each workspace, distinct from just being *a* SuperAdmin
-- (the creator can promote others to SuperAdmin too). Used to gate letting a
-- user change their own role: only the creator can do that, invited members
-- (even invited SuperAdmins) can't self-edit their role.
ALTER TABLE "projects" ADD COLUMN "createdById" TEXT;

ALTER TABLE "projects" ADD CONSTRAINT "projects_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing workspaces: treat the earliest member as the creator,
-- since that's who the project was created together with atomically.
UPDATE "projects" p
SET "createdById" = sub."userId"
FROM (
  SELECT DISTINCT ON ("projectId") "projectId", "userId"
  FROM "memberships"
  ORDER BY "projectId", "joinedAt" ASC, "id" ASC
) sub
WHERE p.id = sub."projectId";
