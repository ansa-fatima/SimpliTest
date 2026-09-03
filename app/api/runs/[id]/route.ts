import { prisma } from '@/lib/db';
import { RunResult } from '@prisma/client';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

const RESULTS: RunResult[] = ['NotRun', 'Passed', 'Failed', 'Blocked', 'Skipped'];

// GET /api/runs/:id  — single run with full test case
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const run = await prisma.testRun.findUnique({
      where: { id: params.id },
      include: {
        testCase: {
          include: {
            suite: { include: { module: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (!run) return notFound('Run not found');
    return ok(run);
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/runs/:id
// Body: { result?: RunResult, notes?: string, executedBy?: string }
// Setting result automatically updates executedAt (or clears it for NotRun).
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{ result?: RunResult; notes?: string; executedBy?: string }>(req);
    if (!body) return bad('invalid JSON body');

    const data: {
      result?: RunResult;
      notes?: string;
      executedBy?: string;
      executedAt?: Date | null;
      wasEverIssue?: boolean;
    } = {};

    if (body.result !== undefined) {
      if (!RESULTS.includes(body.result)) return bad('invalid result');
      data.result = body.result;
      data.executedAt = body.result === 'NotRun' ? null : new Date();
      // Sticks at true the moment a run is ever marked Failed/Blocked, so a
      // later Pass can be told apart from one that never had an issue at
      // all. "Reset to Not run" is the one explicit way to clear it — that
      // action means starting this case's execution over from scratch.
      if (body.result === 'Failed' || body.result === 'Blocked') {
        data.wasEverIssue = true;
      } else if (body.result === 'NotRun') {
        data.wasEverIssue = false;
      }
    }
    if (typeof body.notes === 'string') data.notes = body.notes;
    if (typeof body.executedBy === 'string') data.executedBy = body.executedBy;

    if (Object.keys(data).length === 0) return bad('nothing to update');

    const run = await prisma.testRun.update({
      where: { id: params.id },
      data,
      include: {
        testCase: {
          include: {
            suite: { include: { module: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    return ok(run);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
