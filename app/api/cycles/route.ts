import { prisma } from '@/lib/db';
import { Prisma, CycleScopeType, CycleStatus } from '@prisma/client';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

const SCOPE_TYPES: CycleScopeType[] = ['All', 'Module', 'Suite', 'Custom'];

// GET /api/cycles
//   ?status=Active|Completed|Archived
//   ?projectId=...   scope to a project
// Returns each cycle with embedded summary { total, ...counts }
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const status = sp.get('status') as CycleStatus | null;
    const projectId = sp.get('projectId') || undefined;
    const where: Prisma.TestCycleWhereInput = {};
    if (status && ['Active', 'Completed', 'Archived'].includes(status)) where.status = status;
    if (projectId) where.projectId = projectId;

    const cycles = await prisma.testCycle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        runs: { select: { result: true } },
      },
    });

    // Resolve scope names (module / suite) in batch
    const moduleIds = cycles
      .filter(c => c.scopeType === 'Module' && c.scopeId)
      .map(c => c.scopeId!);
    const suiteIds = cycles.filter(c => c.scopeType === 'Suite' && c.scopeId).map(c => c.scopeId!);
    const [modulesById, suitesById] = await Promise.all([
      moduleIds.length === 0
        ? Promise.resolve([])
        : prisma.module.findMany({
            where: { id: { in: moduleIds } },
            select: { id: true, name: true },
          }),
      suiteIds.length === 0
        ? Promise.resolve([])
        : prisma.suite.findMany({
            where: { id: { in: suiteIds } },
            select: { id: true, name: true, module: { select: { name: true } } },
          }),
    ]);
    const moduleNameById = new Map(modulesById.map(m => [m.id, m.name]));
    const suiteNameById = new Map(suitesById.map(s => [s.id, `${s.module.name} / ${s.name}`]));

    const enriched = cycles.map(c => {
      const counts = { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
      for (const r of c.runs) counts[r.result]++;
      const total = c.runs.length;
      const done = total - counts.NotRun;
      const percent = total === 0 ? 0 : Math.round((done / total) * 100);
      const { runs, ...rest } = c;

      let scopeName: string | null = null;
      if (c.scopeType === 'All') scopeName = 'All test cases';
      else if (c.scopeType === 'Custom') scopeName = 'Custom selection';
      else if (c.scopeType === 'Module' && c.scopeId)
        scopeName = moduleNameById.get(c.scopeId) ?? null;
      else if (c.scopeType === 'Suite' && c.scopeId)
        scopeName = suiteNameById.get(c.scopeId) ?? null;

      return { ...rest, scopeName, summary: { total, done, percent, counts } };
    });

    return ok(enriched);
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/cycles
// Body:
//   { name, description?, projectId,
//     scopeType: 'All'|'Module'|'Suite'|'Custom',
//     scopeId?, testCaseIds?: string[] (only for Custom), targetDate? }
// Auto-populates one TestRun per matched test case.
export async function POST(req: Request) {
  try {
    const body = await parseJson<{
      name?: string;
      description?: string;
      projectId?: string;
      scopeType?: CycleScopeType;
      scopeId?: string | null;
      testCaseIds?: string[];
      targetDate?: string | null;
    }>(req);

    const name = body?.name?.trim();
    if (!name) return bad('name is required');
    if (!body?.projectId) return bad('projectId is required');
    if (!body?.scopeType || !SCOPE_TYPES.includes(body.scopeType)) {
      return bad(`scopeType must be one of ${SCOPE_TYPES.join('|')}`);
    }

    // Resolve which test cases this cycle covers (always scoped to the project)
    let caseIds: string[] = [];
    if (body.scopeType === 'All') {
      const cases = await prisma.testCase.findMany({
        where: { suite: { module: { portal: { projectId: body.projectId } } } },
        select: { id: true },
      });
      caseIds = cases.map(c => c.id);
    } else if (body.scopeType === 'Module') {
      if (!body.scopeId) return bad('scopeId (moduleId) is required for Module scope');
      const cases = await prisma.testCase.findMany({
        where: { suite: { moduleId: body.scopeId } },
        select: { id: true },
      });
      caseIds = cases.map(c => c.id);
    } else if (body.scopeType === 'Suite') {
      if (!body.scopeId) return bad('scopeId (suiteId) is required for Suite scope');
      const cases = await prisma.testCase.findMany({
        where: { suiteId: body.scopeId },
        select: { id: true },
      });
      caseIds = cases.map(c => c.id);
    } else if (body.scopeType === 'Custom') {
      if (!Array.isArray(body.testCaseIds) || body.testCaseIds.length === 0) {
        return bad('testCaseIds is required for Custom scope');
      }
      caseIds = body.testCaseIds;
    }

    const cycle = await prisma.testCycle.create({
      data: {
        name,
        description: body.description ?? '',
        projectId: body.projectId,
        scopeType: body.scopeType,
        scopeId: body.scopeId ?? null,
        targetDate: body.targetDate ? new Date(body.targetDate) : null,
        runs: {
          create: caseIds.map(testCaseId => ({ testCaseId })),
        },
      },
      include: { _count: { select: { runs: true } } },
    });

    return ok(cycle, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
