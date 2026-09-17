import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, serverError } from '@/lib/api';
import { requireWorkspacePermission } from '@/lib/auth';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

// POST /api/users/:id/reset-password — "Manage Team & Roles" (SuperAdmin by
// default, but a SuperAdmin can grant it to another role from Teams).
// Generates a one-time reset link the admin shares directly with the
// teammate (no email sending is configured, so this mirrors the existing
// invite-link trust model rather than a self-service "forgot password").
export async function POST(req: Request, { params }: Ctx) {
  const body = await parseJson<{ projectId?: string }>(req);
  if (!body?.projectId) return bad('projectId is required');
  const guard = await requireWorkspacePermission(body.projectId, 'manageTeamRoles');
  if (guard instanceof NextResponse) return guard;

  try {
    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) return notFound('User not found');

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: params.id },
      data: { resetToken: token, resetTokenExpiresAt: expiresAt },
    });

    return ok({ resetUrl: `/reset-password/${token}`, expiresAt });
  } catch (e) {
    return serverError(e);
  }
}
