// Role identity, shared between the server and (via the API) the Teams
// screen. A workspace's roles are the 5 built-in ones (fixed, same
// name/color/description everywhere -- SuperAdmin, QAManager, Tester,
// Developer, Viewer) PLUS any custom roles a SuperAdmin has added for that
// specific workspace (stored as WorkspaceRole rows). A "role key" is the
// string identity used throughout the Permission Matrix and everywhere a
// Membership/Invite's role is checked: either a built-in role's own name
// (e.g. "SuperAdmin") or a custom role's WorkspaceRole.id.
import { prisma } from '@/lib/db';
import { UserRole } from '@prisma/client';
import { PALETTE_COLORS, PaletteColor, isPaletteColor } from '@/lib/colors';

export const BUILTIN_ROLES: UserRole[] = [
  'SuperAdmin',
  'QAManager',
  'Tester',
  'Developer',
  'Viewer',
];

export const BUILTIN_ROLE_LABEL: Record<UserRole, string> = {
  SuperAdmin: 'Super Admin',
  QAManager: 'QA Manager',
  Tester: 'Tester',
  Developer: 'Developer',
  Viewer: 'Viewer',
};

export const BUILTIN_ROLE_HINTS: Record<UserRole, string> = {
  SuperAdmin:
    'Full access to every area of the platform, including workspace membership and role management.',
  QAManager:
    'Plans cycles, defines scope, reviews reports, and signs off releases based on stability data.',
  Tester:
    'Creates and executes test cases, logs quick logs, and tracks their own execution history.',
  Developer:
    'Checks failures relevant to their module and the stability trend of an area before making changes.',
  Viewer: 'Read-only access to reports and dashboards to check release health.',
};

// Named Tailwind-ish color tokens -- both built-in and custom roles pick
// from this same small palette so a custom role's dot/pill always renders
// with a real, themed color instead of an arbitrary hex value. Re-exported
// from lib/colors.ts, which is the shared palette every colorable
// per-workspace list now uses (see lib/options.ts).
export const ROLE_COLORS = PALETTE_COLORS;
export type RoleColor = PaletteColor;

export const BUILTIN_ROLE_COLOR: Record<UserRole, RoleColor> = {
  SuperAdmin: 'red',
  QAManager: 'indigo',
  Tester: 'emerald',
  Developer: 'amber',
  Viewer: 'slate',
};

export function isBuiltinRole(key: string): key is UserRole {
  return (BUILTIN_ROLES as string[]).includes(key);
}

// A membership/invite's real role identity -- always resolve through this,
// never read `.role` directly (see the schema comment on Membership/Invite:
// `.role` is a meaningless placeholder once `.customRoleId` is set).
export function roleKeyOf(row: { role: UserRole; customRoleId: string | null }): string {
  return row.customRoleId ?? row.role;
}

export interface RoleInfo {
  key: string;
  name: string;
  color: RoleColor;
  isCustom: boolean;
  /** SuperAdmin only -- can't be deleted, renamed, or unassigned as the workspace's owner tier. */
  isProtected: boolean;
}

const isRoleColor = isPaletteColor;

// Every role this workspace currently offers -- built-ins first (in
// BUILTIN_ROLES order), then custom roles in creation order. Built-ins are
// now real WorkspaceRole rows (isBuiltin: true, seeded by
// lib/seedWorkspaceDefaults.ts) so a workspace that's deleted one no longer
// lists it here -- same as a deleted custom role. A workspace created before
// this migration and never backfilled would have none; that's not expected
// to happen in practice (the backfill script covers every existing project).
export async function listWorkspaceRoles(projectId: string): Promise<RoleInfo[]> {
  const rows = await prisma.workspaceRole.findMany({
    where: { projectId },
    orderBy: [{ isBuiltin: 'desc' }, { createdAt: 'asc' }],
  });
  return rows.map(r => ({
    key: r.isBuiltin && r.builtinRole ? r.builtinRole : r.id,
    name: r.name,
    color: isRoleColor(r.color) ? r.color : 'slate',
    isCustom: !r.isBuiltin,
    isProtected: r.builtinRole === 'SuperAdmin',
  }));
}

export async function getWorkspaceRoleKeys(projectId: string): Promise<string[]> {
  const roles = await listWorkspaceRoles(projectId);
  return roles.map(r => r.key);
}
