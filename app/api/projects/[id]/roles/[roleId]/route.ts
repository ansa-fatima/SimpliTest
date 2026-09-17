import { prisma } from '@/lib/db';
import { ok, bad, notFound, serverError } from '@/lib/api';
import { requireWorkspacePermission } from '@/lib/auth';
import { isLastRoleForPermission } from '@/lib/permissions';
import { isBuiltinRole } from '@/lib/roles';
import { UserRole } from '@prisma/client';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string; roleId: string };
}

// DELETE /api/projects/:id/roles/:roleId — remove a role, built-in or
// custom. `roleId` is a role KEY (see lib/roles.ts): either a built-in's
// UserRole name or a WorkspaceRole.id. Refuses if anyone is still assigned
// to it (active member or pending invite) rather than silently downgrading
// them -- reassign those people first -- or if it's the only role left that
// can manage roles & permissions, which would permanently lock the
// workspace out of role management (no direct DB access assumed).
export async function DELETE(_req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'manageTeamRoles');
  if (guard instanceof NextResponse) return guard;

  try {
    const role = isBuiltinRole(params.roleId)
      ? await prisma.workspaceRole.findFirst({
          where: { projectId: params.id, builtinRole: params.roleId },
        })
      : await prisma.workspaceRole.findUnique({ where: { id: params.roleId } });
    if (!role || role.projectId !== params.id) return notFound('Role not found');

    const builtinRole: UserRole | null = role.builtinRole;
    const roleKey = builtinRole ?? role.id;

    const [memberCount, inviteCount] = builtinRole
      ? await Promise.all([
          prisma.membership.count({
            where: {
              projectId: params.id,
              OR: [{ customRoleId: role.id }, { customRoleId: null, role: builtinRole }],
            },
          }),
          prisma.invite.count({
            where: {
              projectId: params.id,
              status: 'Pending',
              OR: [{ customRoleId: role.id }, { customRoleId: null, role: builtinRole }],
            },
          }),
        ])
      : await Promise.all([
          prisma.membership.count({ where: { customRoleId: role.id } }),
          prisma.invite.count({ where: { customRoleId: role.id, status: 'Pending' } }),
        ]);
    if (memberCount > 0 || inviteCount > 0) {
      return bad(
        `Reassign ${memberCount} member(s) and ${inviteCount} pending invite(s) off this role first`,
        409,
      );
    }

    if (await isLastRoleForPermission(params.id, 'manageTeamRoles', roleKey)) {
      return bad(
        'This is the only role that can manage roles & permissions here — grant it to another role first',
        409,
      );
    }

    await prisma.workspaceRole.delete({ where: { id: role.id } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}
