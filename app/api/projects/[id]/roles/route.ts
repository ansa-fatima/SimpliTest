import { prisma } from '@/lib/db';
import { ok, bad, conflict, parseJson, prismaError, serverError } from '@/lib/api';
import { requireUser, requireWorkspacePermission } from '@/lib/auth';
import { listWorkspaceRoles, ROLE_COLORS, RoleColor } from '@/lib/roles';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

// GET /api/projects/:id/roles — every role in this workspace, 5 built-ins
// first then any SuperAdmin-created custom roles. Any member can view (same
// reference every teammate sees on Teams); only "Manage Team & Roles" can add one.
export async function GET(_req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
    });
    if (!membership) return bad('Not a member of this workspace', 403);

    const roles = await listWorkspaceRoles(params.id);
    return ok({ roles });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/projects/:id/roles — create a custom role.
// Body: { name, color? }. Starts with no permissions granted (least
// privilege) until a SuperAdmin checks boxes for it in the Permission Matrix.
export async function POST(req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'manageTeamRoles');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await parseJson<{ name?: string; color?: string }>(req);
    const name = body?.name?.trim();
    if (!name) return bad('name is required');
    if (name.length > 40) return bad('name must be 40 characters or fewer');

    const color: RoleColor = ROLE_COLORS.includes(body?.color as RoleColor)
      ? (body!.color as RoleColor)
      : 'slate';

    const existing = await prisma.workspaceRole.findUnique({
      where: { projectId_name: { projectId: params.id, name } },
    });
    if (existing) return conflict('A role with this name already exists in this workspace');

    const role = await prisma.workspaceRole.create({
      data: { projectId: params.id, name, color },
    });
    return ok(
      { key: role.id, name: role.name, color: role.color, isCustom: true, isProtected: false },
      201,
    );
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/projects/:id/roles — bulk-delete every CUSTOM role in this
// workspace that nobody is currently on (mirrors the single-role guard in
// [roleId]/route.ts). Built-in roles are excluded here -- deleting one is
// deliberate enough to go through the per-role delete button, not swept up
// by "Delete All". Roles still assigned to a member or a pending invite are
// skipped rather than blocking the whole operation -- reassign those first,
// then delete-all again to finish the cleanup.
export async function DELETE(_req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'manageTeamRoles');
  if (guard instanceof NextResponse) return guard;

  try {
    const roles = await prisma.workspaceRole.findMany({
      where: { projectId: params.id, isBuiltin: false },
      select: { id: true, name: true },
    });
    if (roles.length === 0) return ok({ deleted: 0, skipped: [] });

    const counts = await Promise.all(
      roles.map(r =>
        Promise.all([
          prisma.membership.count({ where: { customRoleId: r.id } }),
          prisma.invite.count({ where: { customRoleId: r.id, status: 'Pending' } }),
        ]),
      ),
    );

    const toDelete: string[] = [];
    const skipped: { id: string; name: string }[] = [];
    roles.forEach((r, i) => {
      const [memberCount, inviteCount] = counts[i];
      if (memberCount > 0 || inviteCount > 0) {
        skipped.push({ id: r.id, name: r.name });
      } else {
        toDelete.push(r.id);
      }
    });

    if (toDelete.length > 0) {
      await prisma.workspaceRole.deleteMany({ where: { id: { in: toDelete } } });
    }

    return ok({ deleted: toDelete.length, skipped });
  } catch (e) {
    return serverError(e);
  }
}
