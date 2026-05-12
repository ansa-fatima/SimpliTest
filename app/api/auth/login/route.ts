import { prisma } from '@/lib/db';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { verifyPassword, createSession, setSessionCookie } from '@/lib/auth';

interface LoginBody {
  identifier?: string; // email or username
  password?: string;
}

// POST /api/auth/login
export async function POST(req: Request) {
  try {
    const body = await parseJson<LoginBody>(req);
    const identifier = body?.identifier?.trim().toLowerCase();
    const password = body?.password ?? '';
    if (!identifier || !password) return bad('identifier and password are required');

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: identifier }, { email: identifier }] },
    });

    // Constant-ish timing — always do a hash compare even if user doesn't exist
    // or doesn't have a password (Google-only accounts).
    const dummyHash = '$2a$10$invalid.invalid.invalid.invalid.invalid.invalid.invalid.in';
    const hashToCheck = user?.passwordHash ?? dummyHash;
    const valid = await verifyPassword(password, hashToCheck);

    if (!user || !user.passwordHash || !valid) {
      return bad('Invalid username/email or password', 401);
    }

    const { token, expiresAt } = await createSession(user.id);
    const res = ok({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
    return setSessionCookie(res, token, expiresAt);
  } catch (e) {
    return serverError(e);
  }
}
