-- AlterTable: Jira connection grows a dedicated project key, a JQL
-- prefilter, and a stamp for the last API-token rotation. All three
-- are nullable so an existing connection row keeps working without a
-- backfill; the Settings UI shows placeholders ("Currently syncing
-- project NPD.", "Last rotated Nd ago") only when the value is set.
ALTER TABLE "jira_connections"
    ADD COLUMN "projectKey" TEXT,
    ADD COLUMN "jqlPrefilter" TEXT,
    ADD COLUMN "apiTokenRotatedAt" TIMESTAMP(3);
