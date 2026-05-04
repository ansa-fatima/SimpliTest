import { prisma } from '@/lib/db';
import { Prisma, CycleScopeType, CycleStatus } from '@prisma/client';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

const SCOPE_TYPES: CycleScopeType[] = ['All', 'Module', 'Feature', 'Custom'];

// GET /api/cycles
//   ?status=Active|Completed|Archived  filter
// Returns each cycle with embedded summary { total, ...counts }
export async function GET(req: Request) {
  try {
    const status = new URL(req.url).searchParams.get('status') as CycleStatus | null;
    const where: Prisma.TestCycleWhereInput = {};
    if (status && ['Active', 'Completed', 'Archived'].includes(status)) where.status = status;

    const cycles = await prisma.testCycle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        runs: { select: { result: true } },
      },
    });

    // Resolve scope names (module / feature) in batch
    const moduleIds = cycles.filter(c => c.scopeType === 'Module' && c.scopeId).map(c => c.scopeId!);
    const featureIds = cycles.filter(c => c.scopeType === 'Feature' && c.scopeId).map(c => c.scopeId!);
    const [modulesById, featuresById] = await Promise.all([
      moduleIds.length === 0 ? Promise.resolve([]) :
        prisma.module.findMany({ where: { id: { in: moduleIds } }, select: { id: true, name: true } }),
      featureIds.length === 0 ? Promise.resolve([]) :
        prisma.feature.findMany({
          where: { id: { in: featureIds } },
          select: { id: true, name: true, module: { select: { name: true } } },
        }),
    ]);
    const moduleNameById = new Map(modulesById.map(m => [m.id, m.name]));
    const featureNameById = new Map(featuresById.map(f => [f.id, `${f.module.name} / ${f.name}`]));

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
      else if (c.scopeType === 'Module' && c.scopeId) scopeName = moduleNameById.get(c.scopeId) ?? null;
      else if (c.scopeType === 'Feature' && c.scopeId) scopeName = featureNameById.get(c.scopeId) ?? null;

      return { ...rest, scopeName, summary: { total, done, percent, counts } };
    });

    return ok(enriched);
  } catch (e) { return serverError(e); }
}

// POST /api/cycles
// Body:
//   { name, description?, scopeType: 'All'|'Module'|'Feature'|'Custom',
//     scopeId?, testCaseIds?: string[] (only for Custom), targetDate? }
// Auto-populates one TestRun per matched test case.
export async function POST(req: Request) {
  try {
    const body = await parseJson<{
      name?: string;
      description?: string;
      scopeType?: CycleScopeType;
      scopeId?: string | null;
      testCaseIds?: string[];
      targetDate?: string | null;
    }>(req);

    const name = body?.name?.trim();
    if (!name) return bad('name is required');
    if (!body?.scopeType || !SCOPE_TYPES.includes(body.scopeType)) {
      return bad(`scopeType must be one of ${SCOPE_TYPES.join('|')}`);
    }

    // Resolve which test cases this cycle covers
    let caseIds: string[] = [];
    if (body.scopeType === 'All') {
      const cases = await prisma.testCase.findMany({ select: { id: true } });
      caseIds = cases.map(c => c.id);
    } else if (body.scopeType === 'Module') {
      if (!body.scopeId) return bad('scopeId (moduleId) is required for Module scope');
      const cases = await prisma.testCase.findMany({
        where: { feature: { moduleId: body.scopeId } },
        select: { id: true },
      });
      caseIds = cases.map(c => c.id);
    } else if (body.scopeType === 'Feature') {
      if (!body.scopeId) return bad('scopeId (featureId) is required for Feature scope');
      const cases = await prisma.testCase.findMany({
        where: { featureId: body.scopeId },
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
