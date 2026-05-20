import { prisma } from '@/lib/db';
import { ok, bad, serverError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

// Plan limits — flat for now; later this becomes per-workspace billing.
const PLAN = { name: 'Team', seats: 20 };

// GET /api/members?projectId=...
// Workspace-scoped member list + plan/seat metadata. Caller must be a member
// of the target workspace. Each row carries Membership.role (the user's role
// *inside this workspace*) plus their derived status / lastActiveAt.
export async function GET(req: Request) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const projectId = new URL(req.url).searchParams.get('projectId');
  if (!projectId) return bad('projectId is required');

  try {
    // Caller must belong to this workspace.
    const my = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId } },
    });
    if (!my) return bad('Not a member of this workspace', 403);

    const memberships = await prisma.membership.findMany({
      where: { projectId },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
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
        },
      },
    });

    const items = memberships.map(m => {
      const u = m.user;
      const isActive = !!(u.passwordHash || u.googleId || u.microsoftId);
      return {
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        avatarUrl: u.avatarUrl,
        // Workspace role (membership) — this is what RBAC decisions should use.
        role: m.role,
        status: isActive ? 'Active' : 'Pending',
        createdAt: u.createdAt,
        joinedAt: m.joinedAt,
        lastActiveAt: u.sessions[0]?.createdAt ?? null,
      };
    });

    // Also surface pending invites (people who haven't joined yet).
    const pendingInvites = await prisma.invite.findMany({
      where: { projectId, status: 'Pending' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        token: true,
      },
    });

    const inviteRows = pendingInvites.map(inv => ({
      id: `invite_${inv.id}`,
      username: '',
      name: '',
      email: inv.email,
      avatarUrl: null,
      role: inv.role,
      status: 'Pending' as const,
      createdAt: inv.createdAt,
      joinedAt: null,
      lastActiveAt: null,
      invite: {
        token: inv.token,
        expiresAt: inv.expiresAt,
      },
    }));

    const combined = [...items, ...inviteRows];

    const counts = {
      total: combined.length,
      active: items.length,
      pending: inviteRows.length,
      seatsLeft: Math.max(0, PLAN.seats - combined.length),
    };

    return ok({ items: combined, counts, plan: PLAN, myRole: my.role });
  } catch (e) {
    return serverError(e);
  }
}
