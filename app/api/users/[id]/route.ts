import { prisma } from '@/lib/db';
import { UserRole } from '@prisma/client';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';
import { getCurrentUser, requireRole, hasRole } from '@/lib/auth';
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
  const guard = await requireRole('QAManager');
  if (guard instanceof NextResponse) return guard;

  try {
    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true },
    });
    if (!target) return notFound('User not found');

    const body = await parseJson<{ role?: UserRole; name?: string }>(req);
    const data: { role?: UserRole; name?: string } = {};

    if (typeof body?.name === 'string') data.name = body.name.trim();

    if (body?.role !== undefined) {
      if (!ROLES.includes(body.role)) return bad('invalid role');
      if (guard.id === target.id) return bad('You cannot change your own role', 403);
      const touchingSuperAdmin = target.role === 'SuperAdmin' || body.role === 'SuperAdmin';
      if (touchingSuperAdmin && guard.role !== 'SuperAdmin') {
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
