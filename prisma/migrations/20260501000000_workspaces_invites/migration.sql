-- Adds workspace memberships + invite tokens.

-- 1. InviteStatus enum
CREATE TYPE "InviteStatus" AS ENUM ('Pending', 'Accepted', 'Revoked', 'Expired');

-- 2. memberships table
CREATE TABLE "memberships" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role"      "UserRole" NOT NULL DEFAULT 'Tester',
    "joinedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "memberships_userId_projectId_key" ON "memberships"("userId", "projectId");
CREATE INDEX "memberships_projectId_idx" ON "memberships"("projectId");

ALTER TABLE "memberships"
    ADD CONSTRAINT "memberships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "memberships"
    ADD CONSTRAINT "memberships_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. invites table
CREATE TABLE "invites" (
    "id"          TEXT NOT NULL,
    "projectId"   TEXT NOT NULL,
    "email"       TEXT NOT NULL,
    "role"        "UserRole" NOT NULL DEFAULT 'Tester',
    "token"       TEXT NOT NULL,
    "status"      "InviteStatus" NOT NULL DEFAULT 'Pending',
    "invitedById" TEXT NOT NULL,
    "acceptedAt"  TIMESTAMP(3),
    "expiresAt"   TIMESTAMP(3) NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");
CREATE INDEX "invites_projectId_idx" ON "invites"("projectId");
CREATE INDEX "invites_email_idx" ON "invites"("email");
CREATE INDEX "invites_status_idx" ON "invites"("status");

ALTER TABLE "invites"
    ADD CONSTRAINT "invites_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invites"
    ADD CONSTRAINT "invites_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Backfill: every existing user becomes a member of every existing project
-- with their current global role. This preserves "everyone sees everything" until invites
-- start partitioning access.
INSERT INTO "memberships" ("id", "userId", "projectId", "role", "joinedAt")
SELECT
    'mb_' || substr(md5(u."id" || '_' || p."id"), 1, 22) AS id,
    u."id"        AS "userId",
    p."id"        AS "projectId",
    u."role"      AS "role",
    CURRENT_TIMESTAMP AS "joinedAt"
FROM "users" u
CROSS JOIN "projects" p
ON CONFLICT DO NOTHING;
