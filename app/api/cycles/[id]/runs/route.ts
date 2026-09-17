import { prisma } from '@/lib/db';
import { Prisma, RunResult } from '@prisma/client';
import { ok, serverError } from '@/lib/api';
import { isBuiltinOptionValue } from '@/lib/options';

interface Ctx {
  params: { id: string };
}

// GET /api/cycles/:id/runs
//   ?result=Passed (repeatable) -- a category KEY (see lib/options.ts): a
//     built-in enum literal or a custom RunResult WorkspaceOption.id
//   ?search=...
// Includes the test case + module/feature info for each run.
export async function GET(req: Request, { params }: Ctx) {
  try {
    const sp = new URL(req.url).searchParams;
    const results = sp.getAll('result');
    const search = sp.get('search')?.trim();

    const where: Prisma.TestRunWhereInput = { cycleId: params.id };
    if (results.length) {
      const builtins = results.filter(r => isBuiltinOptionValue('RunResult', r));
      const customs = results.filter(r => !isBuiltinOptionValue('RunResult', r));
      const or: Prisma.TestRunWhereInput[] = [];
      if (builtins.length)
        or.push({ customResultId: null, result: { in: builtins as RunResult[] } });
      if (customs.length) or.push({ customResultId: { in: customs } });
      where.OR = or;
    }
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
            module: { select: { id: true, name: true } },
            portal: { select: { id: true, name: true } },
            suite: { include: { module: { select: { id: true, name: true } } } },
            customPriority: { select: { name: true, color: true } },
            customSeverity: { select: { name: true, color: true } },
            customType: { select: { name: true, color: true } },
          },
        },
        customResult: { select: { name: true, color: true } },
      },
      orderBy: [{ result: 'asc' }, { createdAt: 'asc' }],
    });

    return ok(runs);
  } catch (e) {
    return serverError(e);
  }
}
