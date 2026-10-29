import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser, requireWorkspacePermission } from '@/lib/auth';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';
import { buildBurndown } from '@/lib/plans';
import { parseOptionalDate, planDto, linkRunsToPlan } from '@/lib/planServer';
import type { PlanDefect, PlanDetail } from '@/types';

export const dynamic = 'force-dynamic';

interface Ctx {
  params: { id: string };
}

const creator = { select: { name: true, username: true } } as const;

// GET /api/plans/:id -- the plan plus what only the server can work out cheaply: the
// burn-down series and the latest failed / blocked cases. The linked runs themselves
// come from /api/cycles (each run carries its planId).
export async function GET(_req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;
  try {
    const plan = await prisma.testPlan.findUnique({
      where: { id: params.id },
      include: { createdBy: creator },
    });
    if (!plan) return notFound('Test plan not found');
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: plan.projectId } },
    });
    if (!membership && userOrRes.role !== 'SuperAdmin')
      return bad('Not a member of this workspace', 403);

    const [runs, defectRows, defectCount] = await Promise.all([
      prisma.testRun.findMany({
        where: { cycle: { planId: plan.id } },
        select: { result: true, executedAt: true },
      }),
      prisma.testRun.findMany({
        where: { cycle: { planId: plan.id }, result: { in: ['Failed', 'Blocked'] } },
        orderBy: [{ executedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
        take: 25,
        select: {
          id: true,
          result: true,
          executedAt: true,
          updatedAt: true,
          cycle: { select: { name: true } },
          testCase: {
            select: {
              caseNum: true,
              title: true,
              severity: true,
              customSeverity: { select: { name: true } },
            },
          },
        },
      }),
      prisma.testRun.count({ where: { cycle: { planId: plan.id }, wasEverIssue: true } }),
    ]);

    const defects: PlanDefect[] = defectRows.map(r => ({
      id: r.id,
      caseNum: r.testCase.caseNum,
      title: r.testCase.title,
      severity: r.testCase.customSeverity?.name ?? r.testCase.severity,
      result: r.result,
      runName: r.cycle.name,
      at: (r.executedAt ?? r.updatedAt).toISOString(),
    }));

    const detail: PlanDetail = {
      plan: planDto(plan),
      burndown: buildBurndown(runs, plan.startDate ?? plan.createdAt, plan.dueDate, new Date()),
      defects,
      defectCount,
    };
    return ok(detail);
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/plans/:id
//   { name?, description?, milestone?, status?, startDate?, dueDate?, cycleIds? }
// `cycleIds`, when present, REPLACES the plan's runs with exactly that set -- the
// edit form shows every run with a checkbox, so what it sends is the final picture.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const existing = await prisma.testPlan.findUnique({ where: { id: params.id } });
    if (!existing) return notFound('Test plan not found');
    const guard = await requireWorkspacePermission(existing.projectId, 'createCycles');
    if (guard instanceof NextResponse) return guard;

    const body = await parseJson<{
      name?: string;
      description?: string;
      milestone?: string | null;
      status?: string;
      startDate?: string | null;
      dueDate?: string | null;
      cycleIds?: string[];
    }>(req);
    if (!body) return bad('Invalid request body');

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return bad('Give the plan a name.');
      if (name.length > 160) return bad('The plan name is too long (160 characters at most).');
      data.name = name;
    }
    if (body.description !== undefined) data.description = body.description.trim();
    if (body.milestone !== undefined) data.milestone = body.milestone?.trim() || null;
    if (body.status !== undefined) {
      if (!['Active', 'Completed', 'Archived'].includes(body.status))
        return bad('That plan status is not valid.');
      data.status = body.status;
      data.completedAt = body.status === 'Completed' ? (existing.completedAt ?? new Date()) : null;
    }
    const startDate = body.startDate === undefined ? undefined : parseOptionalDate(body.startDate);
    const dueDate = body.dueDate === undefined ? undefined : parseOptionalDate(body.dueDate);
    if (startDate === 'invalid' || dueDate === 'invalid') return bad('That date is not valid.');
    if (startDate !== undefined) data.startDate = startDate;
    if (dueDate !== undefined) data.dueDate = dueDate;
    const nextStart = startDate === undefined ? existing.startDate : startDate;
    const nextDue = dueDate === undefined ? existing.dueDate : dueDate;
    if (nextStart && nextDue && nextDue.getTime() < nextStart.getTime())
      return bad('The due date cannot be before the start date.');

    const plan = await prisma.testPlan.update({
      where: { id: params.id },
      data,
      include: { createdBy: creator },
    });

    if (Array.isArray(body.cycleIds)) {
      // Anything no longer ticked goes back to standalone; anything ticked joins.
      await prisma.testCycle.updateMany({
        where: { planId: plan.id, id: { notIn: body.cycleIds } },
        data: { planId: null },
      });
      await linkRunsToPlan(plan.id, plan.projectId, plan.milestone, body.cycleIds);
    }
    return ok(planDto(plan));
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/plans/:id -- removes the plan only; its runs (and their results) stay,
// as standalone runs (the planId foreign key is ON DELETE SET NULL).
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const existing = await prisma.testPlan.findUnique({ where: { id: params.id } });
    if (!existing) return notFound('Test plan not found');
    const guard = await requireWorkspacePermission(existing.projectId, 'createCycles');
    if (guard instanceof NextResponse) return guard;
    await prisma.testPlan.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
