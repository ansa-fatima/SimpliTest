import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, serverError } from '@/lib/api';

export const dynamic = 'force-dynamic';

// GET /api/my-todo
// Every case assigned to the signed-in user (TestCase.ownerId) that still has
// work to do inside an Active case-based run, across ALL of their workspaces.
// "Work to do" = result NotRun (pending / retest) or Failed (needs a re-run).
// Sorted by the run's target date (soonest first, undated last).
export async function GET() {
  try {
    const userOrRes = await requireUser();
    if (userOrRes instanceof NextResponse) return userOrRes;
    const user = userOrRes;

    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      select: { projectId: true },
    });
    const projectIds = memberships.map(m => m.projectId);

    const runs = await prisma.testRun.findMany({
      where: {
        result: { in: ['NotRun', 'Failed'] },
        // Mine = the case is owned by me, OR the whole run is assigned to me.
        OR: [{ testCase: { ownerId: user.id } }, { cycle: { assigneeId: user.id } }],
        cycle: {
          status: 'Active',
          mode: 'CaseBased',
          // Super admins see everything they own; everyone else is limited to
          // workspaces they still belong to.
          ...(user.role === 'SuperAdmin' ? {} : { projectId: { in: projectIds } }),
        },
      },
      select: {
        id: true,
        result: true,
        wasEverIssue: true,
        cycle: {
          select: {
            id: true,
            name: true,
            targetDate: true,
            project: { select: { id: true, name: true } },
          },
        },
        testCase: {
          select: {
            id: true,
            caseNum: true,
            title: true,
            priority: true,
            customPriority: { select: { name: true } },
          },
        },
      },
      take: 500,
    });

    const items = runs
      .map(r => ({
        runId: r.id,
        result: r.result as 'NotRun' | 'Failed',
        retest: r.wasEverIssue && r.result === 'NotRun',
        cycleId: r.cycle.id,
        cycleName: r.cycle.name,
        projectId: r.cycle.project.id,
        projectName: r.cycle.project.name,
        dueDate: r.cycle.targetDate ? r.cycle.targetDate.toISOString() : null,
        caseId: r.testCase.id,
        caseNum: r.testCase.caseNum,
        title: r.testCase.title,
        priority: r.testCase.customPriority?.name ?? r.testCase.priority,
      }))
      .sort((a, b) => {
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return a.caseNum - b.caseNum;
      });

    return ok({ items });
  } catch (e) {
    return serverError(e);
  }
}
