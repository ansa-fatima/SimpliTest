// Materializes a workspace's built-in roles and config options as real,
// deletable rows (see prisma/schema.prisma's WorkspaceRole/WorkspaceOption
// comments). Called once per workspace -- from POST /api/projects for new
// workspaces, and from scripts/backfill-workspace-options.ts for existing
// ones. Safe to call more than once (uses skipDuplicates).
import { prisma } from '@/lib/db';
import { OptionCategory } from '@prisma/client';
import { BUILTIN_ROLES, BUILTIN_ROLE_LABEL, BUILTIN_ROLE_COLOR } from '@/lib/roles';
import { LEGACY_RESULT_CLASS } from '@/lib/options';

const BUILTIN_PRIORITY_COLOR: Record<string, string> = {
  High: 'red',
  Medium: 'amber',
  Low: 'emerald',
};
const BUILTIN_SEVERITY_COLOR: Record<string, string> = {
  Critical: 'red',
  Major: 'amber',
  Minor: 'emerald',
};
const BUILTIN_TYPE_COLOR: Record<string, string> = {
  Functional: 'indigo',
  Regression: 'blue',
  Smoke: 'amber',
  Sanity: 'emerald',
  UI: 'pink',
  API: 'teal',
};
const BUILTIN_RESULT_COLOR: Record<string, string> = {
  Passed: 'emerald',
  Failed: 'red',
  Blocked: 'amber',
  Skipped: 'slate',
  NotRun: 'slate',
};

export async function seedWorkspaceDefaults(projectId: string): Promise<void> {
  await prisma.workspaceRole.createMany({
    data: BUILTIN_ROLES.map(r => ({
      projectId,
      name: BUILTIN_ROLE_LABEL[r],
      color: BUILTIN_ROLE_COLOR[r],
      isBuiltin: true,
      builtinRole: r,
    })),
    skipDuplicates: true,
  });

  const optionRows: { category: OptionCategory; name: string; color: string; countsAs?: string }[] =
    [
      ...Object.entries(BUILTIN_PRIORITY_COLOR).map(([name, color]) => ({
        category: 'Priority' as OptionCategory,
        name,
        color,
      })),
      ...Object.entries(BUILTIN_SEVERITY_COLOR).map(([name, color]) => ({
        category: 'Severity' as OptionCategory,
        name,
        color,
      })),
      ...Object.entries(BUILTIN_TYPE_COLOR).map(([name, color]) => ({
        category: 'TestType' as OptionCategory,
        name,
        color,
      })),
      ...Object.entries(BUILTIN_RESULT_COLOR).map(([name, color]) => ({
        category: 'RunResult' as OptionCategory,
        name,
        color,
        countsAs: LEGACY_RESULT_CLASS[name],
      })),
    ];

  await prisma.workspaceOption.createMany({
    data: optionRows.map(o => ({
      projectId,
      category: o.category,
      name: o.name,
      color: o.color,
      isBuiltin: true,
      countsAs: (o.countsAs as 'PassLike' | 'FailLike' | 'Neutral' | undefined) ?? null,
    })),
    skipDuplicates: true,
  });
}
