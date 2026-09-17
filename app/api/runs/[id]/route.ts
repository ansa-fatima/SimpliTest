import { prisma } from '@/lib/db';
import { RunResult } from '@prisma/client';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';
import { resolveCaseOption } from '@/lib/testCaseOptions';

interface Ctx {
  params: { id: string };
}

const runInclude = {
  testCase: {
    include: {
      suite: { include: { module: { select: { id: true, name: true } } } },
      customPriority: { select: { name: true, color: true } },
      customSeverity: { select: { name: true, color: true } },
      customType: { select: { name: true, color: true } },
    },
  },
  customResult: { select: { name: true, color: true } },
} as const;

// GET /api/runs/:id  — single run with full test case
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const run = await prisma.testRun.findUnique({
      where: { id: params.id },
      include: runInclude,
    });
    if (!run) return notFound('Run not found');
    return ok(run);
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/runs/:id
// Body: { result?: string, notes?: string, executedBy?: string }
// `result` is a category KEY (see lib/options.ts) -- a built-in enum
// literal or a custom RunResult WorkspaceOption.id. Setting it automatically
// updates executedAt (or clears it for true "Not run") and wasEverIssue.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{ result?: string; notes?: string; executedBy?: string }>(req);
    if (!body) return bad('invalid JSON body');

    const data: {
      result?: RunResult;
      customResultId?: string | null;
      notes?: string;
      executedBy?: string;
      executedAt?: Date | null;
      wasEverIssue?: boolean;
    } = {};

    if (body.result !== undefined) {
      const existing = await prisma.testRun.findUnique({
        where: { id: params.id },
        select: { cycle: { select: { projectId: true } } },
      });
      if (!existing) return notFound('Run not found');

      // A custom RunResult never means "not yet executed" -- that's a
      // reserved meaning of the literal enum value alone (see
      // prisma/schema.prisma's TestRun.customResultId comment), so the
      // placeholder written to the legacy column when a custom option is
      // chosen is deliberately NOT 'NotRun'.
      const opt = await resolveCaseOption(
        existing.cycle.projectId,
        'RunResult',
        body.result,
        'Skipped',
      );
      if (!opt) return bad('invalid result');

      data.result = opt.enumValue as RunResult;
      data.customResultId = opt.customOptionId;

      const isTrueNotRun = opt.enumValue === 'NotRun' && !opt.customOptionId;
      data.executedAt = isTrueNotRun ? null : new Date();

      // Sticks at true the moment a run is ever marked as a fail-like
      // result, so a later Pass can be told apart from one that never had
      // an issue at all. "Reset to Not run" is the one explicit way to
      // clear it -- that action means starting this case's execution over
      // from scratch.
      let resultClass: 'PassLike' | 'FailLike' | 'Neutral' | null = null;
      if (opt.customOptionId) {
        const customOption = await prisma.workspaceOption.findUnique({
          where: { id: opt.customOptionId },
          select: { countsAs: true },
        });
        resultClass = customOption?.countsAs ?? 'Neutral';
      } else if (opt.enumValue === 'Failed' || opt.enumValue === 'Blocked') {
        resultClass = 'FailLike';
      }
      if (resultClass === 'FailLike') {
        data.wasEverIssue = true;
      } else if (isTrueNotRun) {
        data.wasEverIssue = false;
      }
    }
    if (typeof body.notes === 'string') data.notes = body.notes;
    if (typeof body.executedBy === 'string') data.executedBy = body.executedBy;

    if (Object.keys(data).length === 0) return bad('nothing to update');

    const run = await prisma.testRun.update({
      where: { id: params.id },
      data,
      include: runInclude,
    });

    // Auto-close the run the moment every case in it has a result — saves
    // an explicit "Close run" click for the common case, since there's
    // nothing left "to do". Only fires forward (Active -> Completed); a
    // later "Reset to Not run" doesn't reopen it, since undoing one result
    // on an otherwise-finished run isn't the same as un-finishing it.
    if (body.result !== undefined && !(data.result === 'NotRun' && !data.customResultId)) {
      const stillNotRun = await prisma.testRun.count({
        where: { cycleId: run.cycleId, result: 'NotRun', customResultId: null },
      });
      if (stillNotRun === 0) {
        await prisma.testCycle.updateMany({
          where: { id: run.cycleId, status: 'Active' },
          data: { status: 'Completed' },
        });
      }
    }

    return ok(run);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
