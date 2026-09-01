import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, serverError } from '@/lib/api';
import { hashPassword } from '@/lib/auth';

interface Ctx {
  params: { token: string };
}

// GET /api/reset-password/:token — public peek so the page can render
// "resetting password for X" without requiring the visitor to sign in.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await prisma.user.findUnique({
      where: { resetToken: params.token },
      select: { email: true, resetTokenExpiresAt: true },
    });
    if (!user) return notFound('Reset link not found');
    if (!user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
      return bad('This reset link has expired. Ask an admin for a new one.', 410);
    }
    return ok({ email: user.email, expiresAt: user.resetTokenExpiresAt });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/reset-password/:token — { newPassword } sets the password and
// consumes the token (single use).
export async function POST(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{ newPassword?: string }>(req);
    const newPassword = body?.newPassword ?? '';
    if (newPassword.length < 8) return bad('Password must be at least 8 characters');

    const user = await prisma.user.findUnique({
      where: { resetToken: params.token },
      select: { id: true, resetTokenExpiresAt: true },
    });
    if (!user) return notFound('Reset link not found');
    if (!user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
      return bad('This reset link has expired. Ask an admin for a new one.', 410);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        resetToken: null,
        resetTokenExpiresAt: null,
      },
    });

    return ok({ reset: true });
  } catch (e) {
    return serverError(e);
  }
}
