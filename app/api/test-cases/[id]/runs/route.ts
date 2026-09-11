import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

// GET /api/test-cases/:id/runs
// This case's Execution History -- every CaseBased run ever recorded
// against it, most recently touched first.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const runs = await prisma.testRun.findMany({
      where: { testCaseId: params.id },
      select: {
        id: true,
        result: true,
        executedAt: true,
        updatedAt: true,
        cycle: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    return ok({
      items: runs.map(r => ({
        id: r.id,
        result: r.result,
        ts: (r.executedAt ?? r.updatedAt).toISOString(),
        cycleId: r.cycle.id,
        cycleName: r.cycle.name,
      })),
    });
  } catch (e) {
    return serverError(e);
  }
}
