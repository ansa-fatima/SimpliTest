import { prisma } from '@/lib/db';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { requireUser, requireWorkspacePermission } from '@/lib/auth';
import {
  PERMISSION_KEYS,
  PermissionKey,
  getWorkspacePermissions,
  normalizePermissionMatrix,
  isLockedCell,
} from '@/lib/permissions';
import { getWorkspaceRoleKeys } from '@/lib/roles';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

// GET /api/projects/:id/permissions — the Roles & Permissions matrix for
// this workspace. Any member can view it (it's the same reference page
// every teammate sees on Teams); only SuperAdmin can edit it (see PATCH).
export async function GET(_req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
    });
    if (!membership) return bad('Not a member of this workspace', 403);

    const permissions = await getWorkspacePermissions(params.id);
    return ok({ permissions });
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/projects/:id/permissions — toggle one cell of the matrix.
// Body: { key: PermissionKey, role: roleKey, allowed: boolean } -- role is
// either a built-in role name or a custom WorkspaceRole.id (see lib/roles.ts).
// "Manage Team & Roles" -- gated by that same permission (this route IS it).
export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'manageTeamRoles');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await parseJson<{ key?: PermissionKey; role?: string; allowed?: boolean }>(req);
    if (!body?.key || !PERMISSION_KEYS.includes(body.key)) return bad('invalid permission key');
    if (typeof body.allowed !== 'boolean') return bad('allowed must be a boolean');

    const validRoleKeys = await getWorkspaceRoleKeys(params.id);
    if (!body.role || !validRoleKeys.includes(body.role)) return bad('invalid role');

    if (isLockedCell(body.key, body.role) && !body.allowed) {
      return bad('SuperAdmin must always retain Manage Team & Roles', 400);
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      select: { permissions: true },
    });
    if (!project) return bad('Workspace not found', 404);

    const current = normalizePermissionMatrix(project.permissions, validRoleKeys);
    const roles = new Set(current[body.key]);
    if (body.allowed) roles.add(body.role);
    else roles.delete(body.role);
    const next = { ...current, [body.key]: Array.from(roles) };

    await prisma.project.update({
      where: { id: params.id },
      data: { permissions: next },
    });

    return ok({ permissions: next });
  } catch (e) {
    return serverError(e);
  }
}
