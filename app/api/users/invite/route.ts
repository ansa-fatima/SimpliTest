import { prisma } from '@/lib/db';
import { Prisma, UserRole } from '@prisma/client';
import { ok, bad, conflict, parseJson, prismaError, serverError } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { NextResponse } from 'next/server';

const ROLES: UserRole[] = ['SuperAdmin', 'QAManager', 'Tester', 'Developer', 'Viewer'];

// POST /api/users/invite
// Body: { email, role?, name? }
// Creates a Pending user (no passwordHash, no OAuth link). The user can later be
// activated by signing up with the same email or by setting a password.
// In production this would also send a one-time setup email.
export async function POST(req: Request) {
  const guard = await requireRole('QAManager');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await parseJson<{ email?: string; role?: UserRole; name?: string }>(req);
    const email = body?.email?.trim().toLowerCase();
    if (!email) return bad('email is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('invalid email');

    const role: UserRole = body?.role && ROLES.includes(body.role) ? body.role : 'Tester';

    // SuperAdmin can only be assigned by a SuperAdmin.
    if (role === 'SuperAdmin' && guard.role !== 'SuperAdmin') {
      return bad('Only a SuperAdmin can invite another SuperAdmin', 403);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return conflict('A user with this email already exists');

    // Username has to be unique — derive from local-part + tiny suffix if needed.
    const local =
      email
        .split('@')[0]
        .replace(/[^a-z0-9_-]/gi, '')
        .toLowerCase() || 'user';
    let username = local;
    for (let attempt = 0; attempt < 8; attempt++) {
      const u = await prisma.user.findUnique({ where: { username } });
      if (!u) break;
      username = `${local}-${Math.floor(Math.random() * 9000) + 1000}`;
    }

    const created = await prisma.user.create({
      data: {
        email,
        username,
        name: body?.name?.trim() || '',
        role,
        // passwordHash, googleId, microsoftId all null → status = Pending
      } satisfies Prisma.UserCreateInput,
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    return ok({ ...created, status: 'Pending', lastActiveAt: null }, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
