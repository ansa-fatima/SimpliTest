import { prisma } from '@/lib/db';
import { UserRole } from '@prisma/client';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';
import { getCurrentUser, requireRole, hasRole, hashPassword, verifyPassword } from '@/lib/auth';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

const ROLES: UserRole[] = ['SuperAdmin', 'QAManager', 'Tester', 'Developer', 'Viewer'];

// PATCH /api/users/:id — change role and/or display name.
// Permission rules (privileges scale with role rank):
//   • Caller must be QAManager+
//   • Only a SuperAdmin can demote / promote a SuperAdmin
//   • Users cannot change their own role
export async function PATCH(req: Request, { params }: Ctx) {
  // Two modes:
  //  • Self-edit: a signed-in user updates their own name / email / avatar / password.
  //  • Admin-edit: QAManager+ updates name or role on another user.
  // We pick the right permission gate based on whether the caller IS the target.
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const isSelf = me.id === params.id;
  // Non-self edits still need Manager+.
  if (!isSelf) {
    const guard = await requireRole('QAManager');
    if (guard instanceof NextResponse) return guard;
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true, email: true, passwordHash: true },
    });
    if (!target) return notFound('User not found');

    const body = await parseJson<{
      role?: UserRole;
      name?: string;
      email?: string;
      avatarUrl?: string | null;
      currentPassword?: string;
      newPassword?: string;
    }>(req);
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

    // Role change — Manager+ only (and never on yourself).
    if (body?.role !== undefined) {
      if (isSelf) return bad('You cannot change your own role', 403);
      if (!ROLES.includes(body.role)) return bad('invalid role');
      const touchingSuperAdmin = target.role === 'SuperAdmin' || body.role === 'SuperAdmin';
      if (touchingSuperAdmin && me.role !== 'SuperAdmin') {
        return bad('Only a SuperAdmin can assign or unassign the SuperAdmin role', 403);
      }
      data.role = body.role;
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

// DELETE /api/users/:id — remove a member entirely. SuperAdmin only.
// Cascades: sessions are deleted; owned test cases have their ownerId cleared
// (ON DELETE SET NULL — see TestCase.owner relation in schema).
export async function DELETE(_req: Request, { params }: Ctx) {
  const guard = await requireRole('SuperAdmin');
  if (guard instanceof NextResponse) return guard;

  if (guard.id === params.id) {
    return bad('You cannot remove your own account', 403);
  }

  try {
    await prisma.user.delete({ where: { id: params.id } });
    return ok({ deleted: true });
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
