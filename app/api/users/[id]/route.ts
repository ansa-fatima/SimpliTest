import { prisma } from '@/lib/db';
import { UserRole } from '@prisma/client';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';
import {
  getCurrentUser,
  requireRole,
  requireWorkspacePermission,
  hasRole,
  hashPassword,
  verifyPassword,
} from '@/lib/auth';
import { isBuiltinRole, roleKeyOf, getWorkspaceRoleKeys } from '@/lib/roles';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

// PATCH /api/users/:id — change role and/or display name.
// Permission rules (privileges scale with role rank):
//   • Caller must be QAManager+
//   • Only a SuperAdmin can demote / promote a SuperAdmin
//   • Users cannot change their own role — except the person who created the
//     workspace (pass projectId so we can check), since invited members
//     (even invited SuperAdmins) shouldn't be able to self-promote.
export async function PATCH(req: Request, { params }: Ctx) {
  // Two modes:
  //  • Self-edit: a signed-in user updates their own name / email / avatar / password.
  //  • Admin-edit: QAManager+ updates name or role on another user.
  // We pick the right permission gate based on whether the caller IS the target.
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const isSelf = me.id === params.id;

  try {
    const body = await parseJson<{
      /** A built-in role name or a custom WorkspaceRole.id (see lib/roles.ts). */
      role?: string;
      name?: string;
      email?: string;
      avatarUrl?: string | null;
      currentPassword?: string;
      newPassword?: string;
      /** Which workspace this role change is scoped to — required to let the
       *  workspace creator change their own role (see role-change block below). */
      projectId?: string;
    }>(req);

    // Non-self edits (name/email/role of ANOTHER member) are "Manage Team &
    // Roles" -- checked against this workspace's own Roles & Permissions
    // matrix (SuperAdmin by default, but a SuperAdmin can grant it to
    // another role from the Teams screen). Falls back to a bare SuperAdmin
    // check when no workspace is given.
    if (!isSelf) {
      const guard = body?.projectId
        ? await requireWorkspacePermission(body.projectId, 'manageTeamRoles')
        : await requireRole('SuperAdmin');
      if (guard instanceof NextResponse) return guard;
    }

    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true, email: true, passwordHash: true },
    });
    if (!target) return notFound('User not found');

    const data: {
      role?: UserRole;
      name?: string;
      email?: string;
      avatarUrl?: string | null;
      passwordHash?: string;
    } = {};

    if (typeof body?.name === 'string') data.name = body.name.trim();

    // Email change — must be unique. Allowed for self or Manager+ editing others.
    if (typeof body?.email === 'string') {
      const newEmail = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return bad('invalid email');
      if (newEmail !== target.email.toLowerCase()) {
        const clash = await prisma.user.findUnique({ where: { email: newEmail } });
        if (clash) return bad('That email is already in use', 409);
        data.email = newEmail;
      }
    }

    // Avatar — null/'' clears, a string URL or data: URL sets.
    // Cap data URLs at ~600 KB so a runaway upload can't blow up the row.
    if (body?.avatarUrl !== undefined) {
      if (body.avatarUrl === null || body.avatarUrl === '') {
        data.avatarUrl = null;
      } else if (typeof body.avatarUrl === 'string') {
        const v = body.avatarUrl.trim();
        if (v.startsWith('data:')) {
          if (!/^data:image\/(jpeg|png|webp|gif);base64,/i.test(v)) {
            return bad('Avatar data URL must be image/jpeg, image/png, image/webp, or image/gif');
          }
          if (v.length > 600_000) {
            return bad('Avatar image is too large (max ~450 KB after compression)');
          }
        }
        data.avatarUrl = v;
      }
    }

    // Password change — self-only. Current password required if one is already set.
    if (typeof body?.newPassword === 'string' && body.newPassword.length > 0) {
      if (!isSelf) return bad('Only the user themselves can change their password', 403);
      if (body.newPassword.length < 8) return bad('newPassword must be at least 8 characters');
      if (target.passwordHash) {
        const ok = await verifyPassword(body.currentPassword ?? '', target.passwordHash);
        if (!ok) return bad('Current password is incorrect', 401);
      }
      data.passwordHash = await hashPassword(body.newPassword);
    }

    // Role change — "Manage Team & Roles", scoped to the specific workspace
    // this change applies to (a non-self edit already required that
    // permission there via the guard above). `body.role` is either a
    // built-in role name or a custom WorkspaceRole.id (see lib/roles.ts).
    // Self-edit is blocked unless the caller is the creator of that
    // workspace OR already holds SuperAdmin there — an existing workspace
    // SuperAdmin gains nothing by self-editing that they couldn't already do
    // by editing another account, so gating it just locks people out with no
    // real security benefit. Everyone else (a lower-privileged invited
    // member) still can't self-edit. Updates the workspace's Membership —
    // the authoritative value the Members list and workspace-scoped RBAC
    // read. The legacy global User.role is only kept in sync for a built-in
    // role; a custom role is workspace-scoped by definition and has no
    // meaningful global equivalent, so it's left untouched.
    if (body?.role !== undefined) {
      if (!body.projectId) return bad('projectId is required to change a role');
      const validRoleKeys = await getWorkspaceRoleKeys(body.projectId);
      if (!validRoleKeys.includes(body.role)) return bad('invalid role');

      const [project, targetMembership] = await Promise.all([
        prisma.project.findUnique({
          where: { id: body.projectId },
          select: { createdById: true },
        }),
        prisma.membership.findUnique({
          where: { userId_projectId: { userId: params.id, projectId: body.projectId } },
        }),
      ]);
      if (!targetMembership) return bad('User is not a member of this workspace', 404);

      if (isSelf) {
        const isWorkspaceCreator = !!project && project.createdById === me.id;
        const isWorkspaceSuperAdmin = roleKeyOf(targetMembership) === 'SuperAdmin';
        if (!isWorkspaceCreator && !isWorkspaceSuperAdmin) {
          return bad('You cannot change your own role', 403);
        }
      }

      const newRole = body.role;
      if (isBuiltinRole(newRole)) {
        await prisma.membership.update({
          where: { userId_projectId: { userId: params.id, projectId: body.projectId } },
          data: { role: newRole, customRoleId: null },
        });
        data.role = newRole;
      } else {
        await prisma.membership.update({
          where: { userId_projectId: { userId: params.id, projectId: body.projectId } },
          data: { role: 'Viewer', customRoleId: newRole },
        });
      }
    }

    if (Object.keys(data).length === 0) return bad('nothing to update');

    const updated = await prisma.user.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        passwordHash: true,
        googleId: true,
        microsoftId: true,
        createdAt: true,
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    const status =
      updated.passwordHash || updated.googleId || updated.microsoftId ? 'Active' : 'Pending';
    return ok({
      id: updated.id,
      email: updated.email,
      username: updated.username,
      name: updated.name,
      role: updated.role,
      status,
      createdAt: updated.createdAt,
      lastActiveAt: updated.sessions[0]?.createdAt ?? null,
    });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/users/:id?projectId=... — remove a member from ONE workspace
// (deletes their Membership row only). SuperAdmin in that workspace. This
// used to delete the User account entirely, which didn't match "Remove from
// workspace" -- a member removed from one project stayed a real account,
// still able to sign in and still a member of any OTHER workspace they
// belong to; only their access to THIS project's data goes away, same as
// declining/expiring an invite.
export async function DELETE(req: Request, { params }: Ctx) {
  const projectId = new URL(req.url).searchParams.get('projectId');
  if (!projectId) return bad('projectId is required');

  const guard = await requireWorkspacePermission(projectId, 'manageTeamRoles');
  if (guard instanceof NextResponse) return guard;

  if (guard.id === params.id) {
    return bad('You cannot remove yourself from the workspace', 403);
  }

  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: params.id, projectId } },
    });
    if (!membership) return notFound('User is not a member of this workspace');

    await prisma.membership.delete({ where: { id: membership.id } });
    return ok({ removed: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// GET /api/users/:id — single user lookup (handy for the row drawer later).
export async function GET(_req: Request, { params }: Ctx) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const u = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        avatarUrl: true,
        passwordHash: true,
        googleId: true,
        microsoftId: true,
        createdAt: true,
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    if (!u) return notFound('User not found');
    // Non-managers can only view themselves.
    if (u.id !== me.id && !hasRole(me, 'QAManager')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const status = u.passwordHash || u.googleId || u.microsoftId ? 'Active' : 'Pending';
    return ok({
      id: u.id,
      email: u.email,
      username: u.username,
      name: u.name,
      role: u.role,
      avatarUrl: u.avatarUrl,
      status,
      createdAt: u.createdAt,
      lastActiveAt: u.sessions[0]?.createdAt ?? null,
    });
  } catch (e) {
    return serverError(e);
  }
}
