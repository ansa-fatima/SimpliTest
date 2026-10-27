-- AlterTable: per-workspace settings for AI test-case generation (duplicate check
-- mode, AI tiebreak). Nullable -- existing workspaces use the defaults.
ALTER TABLE "projects" ADD COLUMN "aiSettings" JSONB;
