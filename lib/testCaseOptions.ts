// Shared helpers for resolving a test case's workspace-scoped
// Priority/Severity/TestType option values -- used by both the create and
// edit routes (app/api/test-cases/route.ts, [id]/route.ts). See
// lib/options.ts for the underlying category-key convention.
import { prisma } from '@/lib/db';
import { OptionCategory } from '@prisma/client';
import { getWorkspaceOptionKeys, isBuiltinOptionValue, listWorkspaceOptions } from '@/lib/options';

// A case's workspace, resolved from whichever parent it attaches to --
// needed to validate a submitted priority/severity/type key against THIS
// workspace's WorkspaceOption list (custom options are workspace-scoped).
export async function projectIdForCaseParent(parent: {
  portalId?: string | null;
  moduleId?: string | null;
  suiteId?: string | null;
}): Promise<string | null> {
  if (parent.portalId) {
    const p = await prisma.portal.findUnique({
      where: { id: parent.portalId },
      select: { projectId: true },
    });
    return p?.projectId ?? null;
  }
  if (parent.moduleId) {
    const m = await prisma.module.findUnique({
      where: { id: parent.moduleId },
      select: { portal: { select: { projectId: true } } },
    });
    return m?.portal.projectId ?? null;
  }
  if (parent.suiteId) {
    const s = await prisma.suite.findUnique({
      where: { id: parent.suiteId },
      select: { module: { select: { portal: { select: { projectId: true } } } } },
    });
    return s?.module.portal.projectId ?? null;
  }
  return null;
}

// Resolves a submitted priority/severity/type value (a category KEY, see
// lib/options.ts -- either a built-in enum literal or a custom
// WorkspaceOption.id) into the {enum column, override column} pair to
// write. `fallbackEnum` is a placeholder written to the now-unread legacy
// column when a custom option is chosen, mirroring how a custom ROLE writes
// a placeholder into Membership.role (see lib/roles.ts). Returns null when
// `submitted` is missing or isn't a valid option for this workspace.
export async function resolveCaseOption(
  projectId: string,
  category: OptionCategory,
  submitted: string | undefined,
  fallbackEnum: string,
): Promise<{ enumValue: string; customOptionId: string | null } | null> {
  if (!submitted) return null;
  const validKeys = await getWorkspaceOptionKeys(projectId, category);
  if (!validKeys.includes(submitted)) return null;
  return isBuiltinOptionValue(category, submitted)
    ? { enumValue: submitted, customOptionId: null }
    : { enumValue: fallbackEnum, customOptionId: submitted };
}

export interface ImportOptionMatch {
  /** The category key (see lib/options.ts) -- an enum literal for a built-in, a WorkspaceOption.id for a custom one. */
  key: string;
  isCustom: boolean;
}

// A by-lowercase-name lookup over a workspace's options for a category --
// built for CSV import, which receives free-text values ("high", "Blocker")
// rather than category keys, and needs case-insensitive name matching
// across BOTH built-ins and custom options in one pass.
export async function loadImportOptionResolver(
  projectId: string,
  categories: OptionCategory[],
): Promise<Record<string, Map<string, ImportOptionMatch>>> {
  const byCategory: Record<string, Map<string, ImportOptionMatch>> = {};
  await Promise.all(
    categories.map(async category => {
      const options = await listWorkspaceOptions(projectId, category);
      const byName = new Map<string, ImportOptionMatch>();
      for (const o of options)
        byName.set(o.name.toLowerCase(), { key: o.key, isCustom: o.isCustom });
      byCategory[category] = byName;
    }),
  );
  return byCategory;
}

// Resolves a matched import option into the {enum column, override column}
// pair to write -- same placeholder convention as resolveCaseOption above.
export function toCaseOptionWrite(
  match: ImportOptionMatch | undefined,
  fallbackEnum: string,
): { enumValue: string; customOptionId: string | null } {
  if (!match) return { enumValue: fallbackEnum, customOptionId: null };
  return match.isCustom
    ? { enumValue: fallbackEnum, customOptionId: match.key }
    : { enumValue: match.key, customOptionId: null };
}
