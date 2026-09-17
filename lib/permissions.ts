// Roles & Permissions matrix -- shared source of truth between the Teams
// screen's editable reference table and the (currently one real) permission
// check that's actually wired up: Manage Team & Roles. Stored per-workspace
// on Project.permissions (nullable JSON); a workspace that's never had a
// checkmark edited just uses DEFAULT_PERMISSIONS below.
//
// Only 'manageTeamRoles' gates anything today (invite / change role / remove
// / reset password -- see lib/auth.ts's requireWorkspacePermission and its
// callers). The other keys are real workspace preferences a SuperAdmin can
// record and toggle, but nothing in the API enforces them yet: no route for
// test cases, cycles, runs, reports, or settings checks a role at all right
// now. Toggling those persists the choice without changing real access --
// don't treat a checked box there as proof of enforcement.
//
// A "role" here is a role KEY (see lib/roles.ts) -- a built-in UserRole name
// or a custom WorkspaceRole.id -- never just the fixed 5-value enum, since a
// SuperAdmin-created role must be grantable here too.
import { prisma } from '@/lib/db';
import { BUILTIN_ROLES, getWorkspaceRoleKeys } from '@/lib/roles';

export const PERMISSION_KEYS = [
  'viewDashboard',
  'manageTestCases',
  'createCycles',
  'executeTests',
  'viewReports',
  'manageTeamRoles',
  'settings',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  viewDashboard: 'View Dashboard',
  manageTestCases: 'Manage Test Cases',
  createCycles: 'Create Cycles',
  executeTests: 'Execute Tests / Quick Logs',
  viewReports: 'View Reports',
  manageTeamRoles: 'Manage Team & Roles',
  settings: 'Settings',
};

export type PermissionMatrix = Record<PermissionKey, string[]>;

export const DEFAULT_PERMISSIONS: PermissionMatrix = {
  viewDashboard: ['SuperAdmin', 'QAManager', 'Tester', 'Developer', 'Viewer'],
  manageTestCases: ['SuperAdmin', 'QAManager', 'Tester'],
  createCycles: ['SuperAdmin', 'QAManager'],
  executeTests: ['SuperAdmin', 'QAManager', 'Tester'],
  viewReports: ['SuperAdmin', 'QAManager', 'Tester', 'Developer', 'Viewer'],
  manageTeamRoles: ['SuperAdmin'],
  settings: ['SuperAdmin'],
};

// A SuperAdmin unchecking their own row for Manage Team & Roles would strand
// the workspace -- no one left who can grant it back without direct DB
// access. Same anti-lockout guarantee as the self-role-edit exception in
// /api/users/[id]. Custom roles are never locked.
export function isLockedCell(key: PermissionKey, role: string): boolean {
  return key === 'manageTeamRoles' && role === 'SuperAdmin';
}

// Merge a stored override (raw, untrusted JSON from the DB) over the
// defaults -- key by key, role by role, so a partially-saved or
// hand-edited-in-Studio value can never leave a permission carrying a role
// key that isn't actually one of this workspace's roles (built-in or
// custom) anymore -- e.g. a since-deleted custom role.
export function normalizePermissionMatrix(raw: unknown, validRoleKeys: string[]): PermissionMatrix {
  const result: PermissionMatrix = { ...DEFAULT_PERMISSIONS };
  // A custom role starts with NO permissions until a SuperAdmin grants them
  // -- least-privilege by default, unlike the 5 built-ins' seeded defaults.
  for (const key of PERMISSION_KEYS) {
    result[key] = result[key].filter(r => validRoleKeys.includes(r));
  }
  if (raw && typeof raw === 'object') {
    for (const key of PERMISSION_KEYS) {
      const value = (raw as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        result[key] = value.filter((r): r is string => validRoleKeys.includes(r as string));
      }
    }
  }
  for (const key of PERMISSION_KEYS) {
    // A locked cell (SuperAdmin × Manage Team & Roles) can never be removed
    // by a stored override -- but only while this workspace still HAS a
    // SuperAdmin role row; a workspace that's deleted it (see
    // isLastRoleForPermission) must not have it phantom-reinserted here.
    const locked = BUILTIN_ROLES.filter(
      r => validRoleKeys.includes(r) && isLockedCell(key, r) && !result[key].includes(r),
    );
    if (locked.length > 0) result[key] = [...result[key], ...locked];
  }
  return result;
}

export async function getWorkspacePermissions(projectId: string): Promise<PermissionMatrix> {
  const [project, validRoleKeys] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { permissions: true } }),
    getWorkspaceRoleKeys(projectId),
  ]);
  return normalizePermissionMatrix(project?.permissions, validRoleKeys);
}

export async function hasWorkspacePermission(
  projectId: string,
  key: PermissionKey,
  role: string,
): Promise<boolean> {
  const matrix = await getWorkspacePermissions(projectId);
  return matrix[key].includes(role);
}

// True if removing `roleKeyToRemove` would leave this workspace with ZERO
// roles holding `permissionKey` -- e.g. deleting the only role that can
// still grant "Manage Team & Roles" would permanently lock the workspace
// out of role management (no direct DB access assumed). Generalizes
// isLockedCell's SuperAdmin-only guarantee into a dynamic check so it also
// covers deleting a built-in role (now possible) or a custom role that's
// been granted the same permission. Used by role-delete routes only --
// isLockedCell above still separately guards the matrix UI itself.
export async function isLastRoleForPermission(
  projectId: string,
  permissionKey: PermissionKey,
  roleKeyToRemove: string,
): Promise<boolean> {
  const matrix = await getWorkspacePermissions(projectId);
  return matrix[permissionKey].filter(r => r !== roleKeyToRemove).length === 0;
}
