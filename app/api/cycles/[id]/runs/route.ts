import { prisma } from '@/lib/db';
import { Prisma, RunResult } from '@prisma/client';
import { ok, serverError } from '@/lib/api';

interface Ctx { params: { id: string } }

const RESULTS: RunResult[] = ['NotRun', 'Passed', 'Failed', 'Blocked', 'Skipped'];

// GET /api/cycles/:id/runs
//   ?result=Passed (repeatable)
//   ?search=...
// Includes the test case + module/feature info for each run.
export async function GET(req: Request, { params }: Ctx) {
  try {
    const sp = new URL(req.url).searchParams;
    const results = sp.getAll('result').filter((r): r is RunResult => RESULTS.includes(r as RunResult));
    const search = sp.get('search')?.trim();

    const where: Prisma.TestRunWhereInput = { cycleId: params.id };
    if (results.length) where.result = { in: results };
    if (search) {
      where.testCase = {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { sub: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const runs = await prisma.testRun.findMany({
      where,
      include: {
        testCase: {
          include: {
            feature: { include: { module: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: [{ result: 'asc' }, { createdAt: 'asc' }],
    });

    return ok(runs);
  } catch (e) { return serverError(e); }
}
