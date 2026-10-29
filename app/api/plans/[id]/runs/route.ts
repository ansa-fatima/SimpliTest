import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireWorkspacePermission } from '@/lib/auth';
import { ok, bad, notFound, parseJson, serverError } from '@/lib/api';
import { linkRunsToPlan } from '@/lib/planServer';

export const dynamic = 'force-dynamic';

interface Ctx {
  params: { id: string };
}

// POST /api/plans/:id/runs   { cycleIds: string[] }   add runs to the plan
// DELETE /api/plans/:id/runs { cycleIds: string[] }   take runs out (they stay as standalone runs)
export async function POST(req: Request, { params }: Ctx) {
  try {
    const plan = await prisma.testPlan.findUnique({ where: { id: params.id } });
    if (!plan) return notFound('Test plan not found');
    const guard = await requireWorkspacePermission(plan.projectId, 'createCycles');
    if (guard instanceof NextResponse) return guard;

    const body = await parseJson<{ cycleIds?: string[] }>(req);
    const ids = Array.isArray(body?.cycleIds)
      ? body.cycleIds.filter(x => typeof x === 'string')
      : [];
    if (ids.length === 0) return bad('Choose at least one run to add.');
    const added = await linkRunsToPlan(plan.id, plan.projectId, plan.milestone, ids);
    return ok({ added });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const plan = await prisma.testPlan.findUnique({ where: { id: params.id } });
    if (!plan) return notFound('Test plan not found');
    const guard = await requireWorkspacePermission(plan.projectId, 'createCycles');
    if (guard instanceof NextResponse) return guard;

    const body = await parseJson<{ cycleIds?: string[] }>(req);
    const ids = Array.isArray(body?.cycleIds)
      ? body.cycleIds.filter(x => typeof x === 'string')
      : [];
    if (ids.length === 0) return bad('Choose at least one run to remove.');
    const res = await prisma.testCycle.updateMany({
      where: { id: { in: ids }, planId: plan.id },
      data: { planId: null },
    });
    return ok({ removed: res.count });
  } catch (e) {
    return serverError(e);
  }
}
