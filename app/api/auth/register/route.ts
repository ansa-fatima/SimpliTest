import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { ok, bad, conflict, parseJson, serverError } from '@/lib/api';
import { hashPassword, createSession, setSessionCookie } from '@/lib/auth';

interface RegisterBody {
  username?: string;
  email?: string;
  password?: string;
  name?: string;
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register
export async function POST(req: Request) {
  try {
    const body = await parseJson<RegisterBody>(req);
    const username = body?.username?.trim().toLowerCase();
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password ?? '';
    const name = body?.name?.trim() ?? '';

    if (!username) return bad('username is required');
    if (!USERNAME_RE.test(username)) return bad('username must be 3–32 chars, letters/digits/_.-');
    if (!email) return bad('email is required');
    if (!EMAIL_RE.test(email)) return bad('invalid email');
    if (password.length < 8) return bad('password must be at least 8 characters');

    // Promote to SuperAdmin if no SuperAdmin exists yet — handy when seeding / smoke-testing
    // leaves only Testers behind. Once at least one SuperAdmin exists, new registrants land as Tester.
    const superAdminCount = await prisma.user.count({ where: { role: 'SuperAdmin' } });
    const role = superAdminCount === 0 ? 'SuperAdmin' : 'Tester';

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { username, email, passwordHash, name, role },
      select: { id: true, username: true, email: true, name: true, role: true },
    });

    const { token, expiresAt } = await createSession(user.id);
    const res = ok({ user }, 201);
    return setSessionCookie(res, token, expiresAt);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = (e.meta?.target as string[] | undefined)?.[0];
      return conflict(`${target ?? 'username/email'} is already taken`);
    }
    return serverError(e);
  }
}
