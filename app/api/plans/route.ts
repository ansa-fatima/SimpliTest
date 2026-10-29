import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser, requireWorkspacePermission } from '@/lib/auth';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';
import { parseOptionalDate, planDto, linkRunsToPlan } from '@/lib/planServer';

export const dynamic = 'force-dynamic';

// GET /api/plans?projectId=...   every plan in a workspace, newest first.
// Progress is not computed here: the client rolls it up from the runs (/api/cycles
// carries each run's planId), so the board and the plan page share one source.
export async function GET(req: Request) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;
  try {
    const projectId = new URL(req.url).searchParams.get('projectId');
    if (!projectId) return bad('projectId is required');
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId } },
    });
    if (!membership && userOrRes.role !== 'SuperAdmin')
      return bad('Not a member of this workspace', 403);

    const plans = await prisma.testPlan.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true, username: true } } },
    });
    return ok(plans.map(planDto));
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/plans
//   { projectId, name, description?, milestone?, startDate?, dueDate?, cycleIds?: string[] }
// Creates a plan and (optionally) links existing runs to it in the same call.
export async function POST(req: Request) {
  try {
    const body = await parseJson<{
      projectId?: string;
      name?: string;
      description?: string;
      milestone?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
      cycleIds?: string[];
    }>(req);
    if (!body?.projectId) return bad('projectId is required');
    const guard = await requireWorkspacePermission(body.projectId, 'createCycles');
    if (guard instanceof NextResponse) return guard;

    const name = body.name?.trim();
    if (!name) return bad('Give the plan a name.');
    if (name.length > 160) return bad('The plan name is too long (160 characters at most).');

    const startDate = parseOptionalDate(body.startDate);
    const dueDate = parseOptionalDate(body.dueDate);
    if (startDate === 'invalid' || dueDate === 'invalid') return bad('That date is not valid.');
    if (startDate && dueDate && dueDate.getTime() < startDate.getTime())
      return bad('The due date cannot be before the start date.');

    const milestone = body.milestone?.trim() || null;
    const plan = await prisma.testPlan.create({
      data: {
        projectId: body.projectId,
        name,
        description: body.description?.trim() ?? '',
        milestone,
        startDate,
        dueDate,
        createdById: guard.id,
      },
      include: { createdBy: { select: { name: true, username: true } } },
    });
    if (Array.isArray(body.cycleIds) && body.cycleIds.length > 0)
      await linkRunsToPlan(plan.id, body.projectId, milestone, body.cycleIds);
    return ok(planDto(plan), 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
