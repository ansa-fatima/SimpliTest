import { prisma } from '@/lib/db';
import { ok, notFound, serverError } from '@/lib/api';

interface Ctx { params: { id: string } }

// GET /api/cycles/:id/summary
// { total, done, percent, counts: { NotRun, Passed, Failed, Blocked, Skipped } }
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const cycle = await prisma.testCycle.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!cycle) return notFound('Cycle not found');

    const grouped = await prisma.testRun.groupBy({
      by: ['result'],
      where: { cycleId: params.id },
      _count: { _all: true },
    });

    const counts = { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
    let total = 0;
    for (const row of grouped) {
      counts[row.result] = row._count._all;
      total += row._count._all;
    }
    const done = total - counts.NotRun;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    return ok({ total, done, percent, counts });
  } catch (e) { return serverError(e); }
}
