import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, serverError } from '@/lib/api';
import { getCurrentUser, hashPassword, createSession, setSessionCookie } from '@/lib/auth';
import { Prisma } from '@prisma/client';

interface Ctx {
  params: { token: string };
}

// POST /api/invites/:token/accept
// Two modes:
//   1) Signed-in: just attach a Membership to the existing user and mark the invite Accepted.
//   2) Signed-out + body { username, password, name } → create the user with the invite email,
//      then attach the membership. Sets a fresh session cookie.
//
// Returns: { user, projectId, projectName }
export async function POST(req: Request, { params }: Ctx) {
  try {
    const invite = await prisma.invite.findUnique({
      where: { token: params.token },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!invite) return notFound('Invite not found');
    if (invite.status !== 'Pending') {
      return bad(`This invite is ${invite.status.toLowerCase()}`);
    }
    if (invite.expiresAt < new Date()) {
      await prisma.invite.update({
        where: { id: invite.id },
        data: { status: 'Expired' },
      });
      return bad('This invite has expired');
    }

    const me = await getCurrentUser();
    let userId: string;
    let setCookie: { token: string; expiresAt: Date } | null = null;

    if (me) {
      // Signed-in mode: must use the matching email.
      if (me.email.toLowerCase() !== invite.email.toLowerCase()) {
        return bad(
          `This invite was sent to ${invite.email}. Sign in with that account to accept.`,
          403,
        );
      }
      userId = me.id;
    } else {
      // Signed-out mode: register-with-invite. Username + password are required.
      const body = await parseJson<{ username?: string; password?: string; name?: string }>(req);
      const username = body?.username?.trim().toLowerCase();
      const password = body?.password ?? '';
      const name = body?.name?.trim() ?? '';
      if (!username || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
        return bad('username must be 3–32 chars, letters/digits/_.-');
      }
      if (password.length < 8) return bad('password must be at least 8 characters');

      // Don't allow re-creating an account that already exists for this email.
      const existing = await prisma.user.findUnique({ where: { email: invite.email } });
      if (existing) {
        return bad('An account already exists for this email. Sign in to accept the invite.');
      }

      const passwordHash = await hashPassword(password);
      const created = await prisma.user.create({
        data: {
          email: invite.email,
          username,
          name,
          passwordHash,
          role: invite.role,
        },
      });
      userId = created.id;
      setCookie = await createSession(userId);
    }

    // Create or refresh the Membership atomically with marking the invite accepted.
    await prisma.$transaction([
      prisma.membership.upsert({
        where: { userId_projectId: { userId, projectId: invite.projectId } },
        update: { role: invite.role },
        create: { userId, projectId: invite.projectId, role: invite.role },
      }),
      prisma.invite.update({
        where: { id: invite.id },
        data: { status: 'Accepted', acceptedAt: new Date() },
      }),
    ]);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true, name: true, role: true },
    });

    const res = ok(
      {
        user,
        project: { id: invite.project.id, name: invite.project.name },
      },
      200,
    );
    if (setCookie) {
      return setSessionCookie(res, setCookie.token, setCookie.expiresAt);
    }
    return res;
  } catch (e) {
    // Username collision is the common error path.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = (e.meta?.target as string[] | undefined)?.[0];
      return bad(`${target ?? 'username'} is already taken`, 409);
    }
    return serverError(e);
  }
}
