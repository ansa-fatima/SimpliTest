// Server-side helpers shared by the /api/plans routes.
import { prisma } from '@/lib/db';
import type { Prisma, TestPlan as DbPlan } from '@prisma/client';
import type { TestPlan } from '@/types';

type PlanWithCreator = DbPlan & { createdBy: { name: string; username: string } | null };

export function planDto(p: PlanWithCreator): TestPlan {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    milestone: p.milestone,
    startDate: p.startDate?.toISOString() ?? null,
    dueDate: p.dueDate?.toISOString() ?? null,
    completedAt: p.completedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    projectId: p.projectId,
    createdById: p.createdById,
    createdByName: p.createdBy ? p.createdBy.name || p.createdBy.username : null,
  };
}

/**
 * A "YYYY-MM-DD" from a date input becomes noon UTC so it lands on the same calendar
 * day in every timezone (midnight UTC would read as the day before west of Greenwich).
 * Empty / null clears the date; anything unparseable is reported as 'invalid'.
 */
export function parseOptionalDate(v: string | null | undefined): Date | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return 'invalid';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00.000Z`) : new Date(v);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

/**
 * Put runs into a plan. Only case-based runs from the plan's own workspace can join
 * (a quick log has no executions to roll up). A run with no version of its own
 * inherits the plan's milestone, as the plan page promises.
 */
export async function linkRunsToPlan(
  planId: string,
  projectId: string,
  milestone: string | null,
  cycleIds: string[],
): Promise<number> {
  const where: Prisma.TestCycleWhereInput = {
    id: { in: cycleIds },
    projectId,
    mode: 'CaseBased',
  };
  const res = await prisma.testCycle.updateMany({ where, data: { planId } });
  if (milestone) {
    await prisma.testCycle.updateMany({
      where: { ...where, OR: [{ version: null }, { version: '' }] },
      data: { version: milestone },
    });
  }
  return res.count;
}
