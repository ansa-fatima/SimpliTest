import { prisma } from '@/lib/db';
import { ok, notFound, bad, serverError } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';

interface Ctx {
  params: { token: string };
}

// GET /api/invites/:token  — public peek so the accept page can render workspace name + role
// without forcing the user to authenticate first.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const invite = await prisma.invite.findUnique({
      where: { token: params.token },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        project: { select: { id: true, name: true, slug: true } },
        invitedBy: { select: { id: true, name: true, username: true, email: true } },
      },
    });
    if (!invite) return notFound('Invite not found');

    // Auto-expire stale rows so the UI never accepts a dead invite.
    let status = invite.status;
    if (status === 'Pending' && invite.expiresAt < new Date()) {
      await prisma.invite.update({
        where: { id: invite.id },
        data: { status: 'Expired' },
      });
      status = 'Expired';
    }

    // Tell the front-end whether the current visitor is signed in AND if so,
    // whether the signed-in user is the intended recipient (matching email).
    const me = await getCurrentUser();
    return ok({
      invite: { ...invite, status },
      viewer: me
        ? {
            id: me.id,
            email: me.email,
            isInvitee: me.email.toLowerCase() === invite.email.toLowerCase(),
          }
        : null,
    });
  } catch (e) {
    return serverError(e);
  }
}

// DELETE /api/invites/:token — revoke a pending invite (caller must be inviter or workspace manager).
export async function DELETE(_req: Request, { params }: Ctx) {
  const me = await getCurrentUser();
  if (!me) return bad('Not authenticated', 401);

  try {
    const invite = await prisma.invite.findUnique({
      where: { token: params.token },
      select: { id: true, projectId: true, invitedById: true, status: true },
    });
    if (!invite) return notFound('Invite not found');
    if (invite.status !== 'Pending') return bad('Invite is no longer pending');

    let allowed = invite.invitedById === me.id;
    if (!allowed) {
      const m = await prisma.membership.findUnique({
        where: { userId_projectId: { userId: me.id, projectId: invite.projectId } },
      });
      if (m && (m.role === 'SuperAdmin' || m.role === 'QAManager')) allowed = true;
    }
    if (!allowed) return bad('Insufficient permissions', 403);

    await prisma.invite.update({
      where: { id: invite.id },
      data: { status: 'Revoked' },
    });
    return ok({ revoked: true });
  } catch (e) {
    return serverError(e);
  }
}
