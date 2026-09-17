// Per-workspace configurable value lists -- Priority/Severity/TestType/
// RunResult (legacy, mandatory Postgres enums on TestCase/TestRun) plus
// Platform/Environment/Version (already free text). See
// prisma/schema.prisma's WorkspaceOption comment for the storage model and
// lib/roles.ts's roleKeyOf() for the pattern this generalizes.
import { prisma } from '@/lib/db';
import {
  Prisma,
  OptionCategory,
  RunResultClass,
  Priority,
  Severity,
  TestType,
  RunResult,
} from '@prisma/client';
import { PaletteColor, isPaletteColor } from '@/lib/colors';

// The fixed enum vocabulary per category -- used to tell whether a
// submitted value is a built-in (write the legacy enum column) or a custom
// WorkspaceOption id (write the override column), the same role a plain
// `key === 'SuperAdmin'` string check plays for roles. Platform/Environment/
// Version have no enum (free text), so they're never "builtin" this way.
const BUILTIN_VALUES: Partial<Record<OptionCategory, readonly string[]>> = {
  Priority: Object.values(Priority),
  Severity: Object.values(Severity),
  TestType: Object.values(TestType),
  RunResult: Object.values(RunResult),
};

export function isBuiltinOptionValue(category: OptionCategory, value: string): boolean {
  return (BUILTIN_VALUES[category] ?? []).includes(value);
}

// The 5 legacy RunResult values' pass/fail classification -- used to backfill
// their WorkspaceOption.countsAs and to classify any run that still carries
// the legacy enum value with no custom override.
export const LEGACY_RESULT_CLASS: Record<string, RunResultClass> = {
  Passed: 'PassLike',
  Failed: 'FailLike',
  Blocked: 'FailLike',
  NotRun: 'Neutral',
  Skipped: 'Neutral',
};

export interface OptionInfo {
  key: string;
  name: string;
  color: PaletteColor;
  isCustom: boolean;
  isProtected: boolean;
  countsAs: RunResultClass | null;
}

// A record's effective value -- always resolve through this, never read the
// legacy enum column directly once a custom override is possible (mirrors
// lib/roles.ts's roleKeyOf()). Callers pass the enum/override pair
// explicitly since the field names differ per category, e.g.
// optionKeyOf({ enumValue: tc.priority, customOptionId: tc.customPriorityId }).
export function optionKeyOf(row: { enumValue: string; customOptionId: string | null }): string {
  return row.customOptionId ?? row.enumValue;
}

// Every option in a category for this workspace -- built-ins first (in enum
// declaration order), then custom options in creation order. Used to
// populate Settings > Test Configuration lists and value-picker dropdowns.
// A built-in's `key` is its legacy enum literal (e.g. "High"), NOT its row
// id -- mirroring lib/roles.ts's built-ins being keyed by their UserRole
// name -- so it matches what a legacy, never-overridden TestCase/TestRun
// already carries in its enum column. Only a custom option's key is its
// WorkspaceOption.id.
export async function listWorkspaceOptions(
  projectId: string,
  category: OptionCategory,
): Promise<OptionInfo[]> {
  const rows = await prisma.workspaceOption.findMany({
    where: { projectId, category },
    orderBy: [{ isBuiltin: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(r => ({
    key: r.isBuiltin ? r.name : r.id,
    name: r.name,
    color: isPaletteColor(r.color) ? r.color : 'slate',
    isCustom: !r.isBuiltin,
    // A built-in can't be renamed away from its legacy enum meaning today,
    // so it's protected the same way SuperAdmin's role row is.
    isProtected: r.isBuiltin,
    countsAs: r.countsAs,
  }));
}

export async function getWorkspaceOptionKeys(
  projectId: string,
  category: OptionCategory,
): Promise<string[]> {
  const options = await listWorkspaceOptions(projectId, category);
  return options.map(o => o.key);
}

export interface OptionDisplay {
  name: string;
  color: PaletteColor;
}

// Preloads a category's options as two lookup maps -- by WorkspaceOption.id
// (for a record whose override column is set) and by legacy enum literal
// (for a record with no override, matching the built-in's `name`, which is
// always exactly its enum value -- see lib/seedWorkspaceDefaults.ts). Load
// once per request, then call resolveOptionDisplay() per row -- no query
// per row when resolving many TestCase/TestRun rows at once.
export async function loadOptionDisplayMaps(
  projectId: string,
  category: OptionCategory,
): Promise<{ byId: Map<string, OptionDisplay>; byName: Map<string, OptionDisplay> }> {
  const rows = await prisma.workspaceOption.findMany({ where: { projectId, category } });
  const byId = new Map<string, OptionDisplay>();
  const byName = new Map<string, OptionDisplay>();
  for (const r of rows) {
    const info: OptionDisplay = {
      name: r.name,
      color: isPaletteColor(r.color) ? r.color : 'slate',
    };
    byId.set(r.id, info);
    byName.set(r.name, info);
  }
  return { byId, byName };
}

// A record's effective display (name + color) -- an override points at a
// custom row by id, otherwise match the legacy enum literal by name. Falls
// back to `fallback` if the workspace's options were never seeded (should
// not happen given the backfill script + new-project seeding, but keeps a
// record renderable rather than blank if it ever does).
export function resolveOptionDisplay(
  maps: { byId: Map<string, OptionDisplay>; byName: Map<string, OptionDisplay> },
  row: { enumValue: string; customOptionId: string | null },
  fallback: OptionDisplay,
): OptionDisplay {
  const found = row.customOptionId
    ? maps.byId.get(row.customOptionId)
    : maps.byName.get(row.enumValue);
  return found ?? fallback;
}

// A run's pass/fail classification -- legacy literal values map through
// LEGACY_RESULT_CLASS, a custom override reads its own countsAs. `byId`
// should be preloaded (e.g. via loadRunResultClassMap) so this stays a pure
// lookup, no query, when scoring many runs at once.
export function resultClassOf(
  run: { result: string; customResultId: string | null },
  byId: Map<string, RunResultClass>,
): RunResultClass {
  if (run.customResultId) {
    return byId.get(run.customResultId) ?? 'Neutral';
  }
  return LEGACY_RESULT_CLASS[run.result] ?? 'Neutral';
}

// Preloads every RunResult option's countsAs for a workspace, keyed by
// WorkspaceOption.id -- feed straight into resultClassOf's `byId` param.
export async function loadRunResultClassMap(
  projectId: string,
): Promise<Map<string, RunResultClass>> {
  const rows = await prisma.workspaceOption.findMany({
    where: { projectId, category: 'RunResult', isBuiltin: false },
    select: { id: true, countsAs: true },
  });
  const map = new Map<string, RunResultClass>();
  for (const r of rows) map.set(r.id, r.countsAs ?? 'Neutral');
  return map;
}

// Builds a Prisma OR clause matching every TestRun whose EFFECTIVE result
// classification (see resultClassOf) is one of `classes` -- for queries that
// need to select "every passing run" or "every failing run" etc. without
// hardcoding the 5 legacy literals, so a custom RunResult option (e.g. a
// "Won't Fix" marked FailLike) is included on the same footing as Failed/
// Blocked. Needs a DB round-trip to know which custom options match.
export async function runResultClassWhereClause(
  projectId: string,
  classes: RunResultClass[],
): Promise<Prisma.TestRunWhereInput> {
  const legacyLiterals = Object.entries(LEGACY_RESULT_CLASS)
    .filter(([, cls]) => classes.includes(cls))
    .map(([literal]) => literal as RunResult);
  const customOptions = await prisma.workspaceOption.findMany({
    where: { projectId, category: 'RunResult', isBuiltin: false, countsAs: { in: classes } },
    select: { id: true },
  });
  const or: Prisma.TestRunWhereInput[] = [];
  if (legacyLiterals.length) or.push({ customResultId: null, result: { in: legacyLiterals } });
  if (customOptions.length) or.push({ customResultId: { in: customOptions.map(o => o.id) } });
  return { OR: or };
}

// JS-side counterpart to stabilityResultWhereClause -- for callers that
// already have runs in memory (e.g. via a nested Prisma `include`) rather
// than issuing a fresh query. `classMap` should be preloaded via
// loadRunResultClassMap.
export function countsForStability(
  r: { result: string; customResultId: string | null },
  classMap: Map<string, RunResultClass>,
): boolean {
  if (r.customResultId) {
    const cls = classMap.get(r.customResultId);
    return cls === 'PassLike' || cls === 'FailLike';
  }
  return r.result === 'Passed' || r.result === 'Failed';
}

// "Failed" for KPIs that keep Blocked as a separate bucket (e.g. the
// Dashboard's Failed/Blocked tiles) -- a custom FailLike option joins the
// Failed side, since the countsAs schema has no sub-distinction for
// "blocked-like". `result: 'Failed'` alone (no Blocked) preserves the exact
// legacy literal behavior these KPIs have always had.
export async function failedOnlyResultWhereClause(
  projectId: string,
): Promise<Prisma.TestRunWhereInput> {
  const failLikeCustoms = await prisma.workspaceOption.findMany({
    where: { projectId, category: 'RunResult', isBuiltin: false, countsAs: 'FailLike' },
    select: { id: true },
  });
  const or: Prisma.TestRunWhereInput[] = [{ customResultId: null, result: 'Failed' }];
  if (failLikeCustoms.length) or.push({ customResultId: { in: failLikeCustoms.map(o => o.id) } });
  return { OR: or };
}

// Narrower than runResultClassWhereClause(['PassLike','FailLike']): stability
// scoring (lib/stability.ts) has always excluded Blocked runs entirely
// (neither a pass nor a fail -- the test literally couldn't be attempted, so
// it says nothing about whether the feature itself is stable), even though
// Blocked IS classified FailLike for wasEverIssue/"open defect" purposes
// elsewhere. Preserves that exact legacy-literal behavior while still
// extending to custom Pass/FailLike options, which have no such historical
// carve-out.
export async function stabilityResultWhereClause(
  projectId: string,
): Promise<Prisma.TestRunWhereInput> {
  const customOptions = await prisma.workspaceOption.findMany({
    where: {
      projectId,
      category: 'RunResult',
      isBuiltin: false,
      countsAs: { in: ['PassLike', 'FailLike'] },
    },
    select: { id: true },
  });
  const or: Prisma.TestRunWhereInput[] = [
    { customResultId: null, result: { in: ['Passed', 'Failed'] } },
  ];
  if (customOptions.length) or.push({ customResultId: { in: customOptions.map(o => o.id) } });
  return { OR: or };
}
