import { prisma } from '@/lib/db';
import { UserRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { ok, bad, conflict, parseJson, prismaError, serverError } from '@/lib/api';
import { requireUser, hasRole } from '@/lib/auth';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

const ROLES: UserRole[] = ['SuperAdmin', 'QAManager', 'Tester', 'Developer', 'Viewer'];

// 7 days TTL by default.
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// GET /api/projects/:id/invites — list pending invites for the workspace.
export async function GET(_req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    const ok_ = await assertWorkspaceManager(userOrRes.id, params.id);
    if (ok_ instanceof NextResponse) return ok_;

    const invites = await prisma.invite.findMany({
      where: { projectId: params.id, status: 'Pending' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        token: true,
        invitedBy: { select: { id: true, name: true, username: true, email: true } },
      },
    });
    return ok({
      items: invites.map(i => ({
        ...i,
        acceptUrl: acceptUrlFor(i.token),
      })),
    });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/projects/:id/invites
// Body: { email, role?, name? }  → returns the created invite + shareable accept URL.
export async function POST(req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    const membership = await assertWorkspaceManager(userOrRes.id, params.id);
    if (membership instanceof NextResponse) return membership;

    const body = await parseJson<{ email?: string; role?: UserRole; name?: string }>(req);
    const email = body?.email?.trim().toLowerCase();
    if (!email) return bad('email is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('invalid email');

    const role: UserRole = body?.role && ROLES.includes(body.role) ? body.role : 'Tester';
    // Only a workspace SuperAdmin can invite another SuperAdmin.
    if (role === 'SuperAdmin' && membership.role !== 'SuperAdmin') {
      return bad('Only a SuperAdmin can invite another SuperAdmin', 403);
    }

    // If this email already belongs to a workspace member, short-circuit.
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const alreadyMember = await prisma.membership.findUnique({
        where: { userId_projectId: { userId: existingUser.id, projectId: params.id } },
      });
      if (alreadyMember) {
        return conflict('This email is already a member of the workspace');
      }
    }

    // If there's already a pending invite, refresh it instead of creating a second one.
    const existing = await prisma.invite.findFirst({
      where: { projectId: params.id, email, status: 'Pending' },
    });
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = existing
      ? await prisma.invite.update({
          where: { id: existing.id },
          data: { role, token, expiresAt, invitedById: userOrRes.id },
        })
      : await prisma.invite.create({
          data: {
            projectId: params.id,
            email,
            role,
            token,
            expiresAt,
            invitedById: userOrRes.id,
          },
        });

    return ok(
      {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        token: invite.token,
        expiresAt: invite.expiresAt,
        acceptUrl: acceptUrlFor(invite.token),
      },
      201,
    );
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// Helper: returns the calling user's membership in the workspace if they are QAManager+, else 401/403.
async function assertWorkspaceManager(userId: string, projectId: string) {
  const m = await prisma.membership.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (!m) {
    return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
  }
  if (!hasRole({ id: userId, username: '', email: '', name: '', role: m.role }, 'QAManager')) {
    return NextResponse.json(
      { error: 'Requires QAManager or higher in this workspace' },
      { status: 403 },
    );
  }
  return m;
}

function acceptUrlFor(token: string): string {
  // Front-end will replace with full URL when it knows window.location; for API we return path.
  return `/invite/${token}`;
}
