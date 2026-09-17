import { prisma } from '@/lib/db';
import { ok, bad, serverError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

const DEFAULTS = {
  cycleCompletion: true,
  failedTests: true,
  criticalDefects: true,
  reopenedDefects: true,
  recurringIssues: false,
};

// GET/PATCH /api/projects/:id/notifications — the CALLER's own toggle
// preferences for this workspace (Settings > Notifications). Personal, not
// workspace-wide -- any member can read/edit their own, no "Settings"
// permission required. No email/push sending exists anywhere in this app
// yet; these persist the choice only.
export async function GET(_req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
    });
    if (!membership) return bad('Not a member of this workspace', 403);

    const pref = await prisma.notificationPreference.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
    });
    return ok({ preferences: pref ?? DEFAULTS });
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
    });
    if (!membership) return bad('Not a member of this workspace', 403);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Invalid body');

    const data: Partial<typeof DEFAULTS> = {};
    for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      if (typeof body[key] === 'boolean') data[key] = body[key];
    }

    const pref = await prisma.notificationPreference.upsert({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
      create: { userId: userOrRes.id, projectId: params.id, ...DEFAULTS, ...data },
      update: data,
    });
    return ok({ preferences: pref });
  } catch (e) {
    return serverError(e);
  }
}
