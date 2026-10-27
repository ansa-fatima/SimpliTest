import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser, requireWorkspacePermission } from '@/lib/auth';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { normalizeAiSettings } from '@/lib/aiSettings';
import { resolveAiConfig } from '@/lib/aiConfig';

export const dynamic = 'force-dynamic';

interface Ctx {
  params: { id: string };
}

// GET /api/projects/:id/ai-settings -- any signed-in workspace member can read.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const userOrRes = await requireUser();
    if (userOrRes instanceof NextResponse) return userOrRes;
    const project = await prisma.project.findUnique({
      where: { id: params.id },
      select: {
        aiSettings: true,
        memberships: { where: { userId: userOrRes.id }, select: { id: true } },
      },
    });
    if (!project) return bad('Workspace not found', 404);
    if (project.memberships.length === 0 && userOrRes.role !== 'SuperAdmin')
      return bad('Not a member of this workspace', 403);
    return ok({
      settings: normalizeAiSettings(project.aiSettings),
      configured: !!(await resolveAiConfig(params.id).catch(() => null)),
    });
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/projects/:id/ai-settings -- needs the workspace "Settings" permission.
export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'settings');
  if (guard instanceof NextResponse) return guard;
  try {
    const body = await parseJson<{ duplicateCheck?: string; aiTiebreak?: boolean }>(req);
    if (!body) return bad('Invalid request body');
    const project = await prisma.project.findUnique({
      where: { id: params.id },
      select: { aiSettings: true },
    });
    if (!project) return bad('Workspace not found', 404);
    const next = normalizeAiSettings({ ...normalizeAiSettings(project.aiSettings), ...body });
    await prisma.project.update({
      where: { id: params.id },
      data: { aiSettings: next as unknown as Prisma.InputJsonValue },
    });
    return ok({ settings: next });
  } catch (e) {
    return serverError(e);
  }
}
