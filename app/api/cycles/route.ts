import { prisma } from '@/lib/db';
import { Prisma, CycleScopeType, CycleStatus, CycleMode } from '@prisma/client';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

const SCOPE_TYPES: CycleScopeType[] = ['All', 'Portal', 'Module', 'Suite', 'Custom'];
const MODES: CycleMode[] = ['CaseBased', 'Manual'];

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

    // Resolve scope names (portal / module / suite) in batch
    const portalIds = cycles
      .filter(c => c.scopeType === 'Portal' && c.scopeId)
      .map(c => c.scopeId!);
    const moduleIds = cycles
      .filter(c => c.scopeType === 'Module' && c.scopeId)
      .map(c => c.scopeId!);
    const suiteIds = cycles.filter(c => c.scopeType === 'Suite' && c.scopeId).map(c => c.scopeId!);
    const [portalsById, modulesById, suitesById] = await Promise.all([
      portalIds.length === 0
        ? Promise.resolve([])
        : prisma.portal.findMany({
            where: { id: { in: portalIds } },
            select: { id: true, name: true },
          }),
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
    const portalNameById = new Map(portalsById.map(p => [p.id, p.name]));
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
      else if (c.scopeType === 'Portal' && c.scopeId)
        scopeName = portalNameById.get(c.scopeId) ?? null;
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
      mode?: CycleMode;
      scopeType?: CycleScopeType;
      scopeId?: string | null;
      testCaseIds?: string[];
      targetDate?: string | null;

      // Manual-mode fields
      portalName?: string;
      moduleName?: string;
      featureName?: string;
      environment?: string;
      platform?: string;
      version?: string;
      cycleCategory?: string;
      ticketLink?: string;
      issueCount?: number;
      criticalCount?: number;
      majorCount?: number;
      minorCount?: number;
      doneCount?: number;
      remainingCount?: number;
      passedCount?: number;
      failedCount?: number;
      blockedCount?: number;
    }>(req);

    const name = body?.name?.trim();
    if (!name) return bad('name is required');
    if (!body?.projectId) return bad('projectId is required');

    const mode: CycleMode = body?.mode && MODES.includes(body.mode) ? body.mode : 'CaseBased';

    // ── Manual mode: just create the cycle row with counts. No TestRuns. ──
    // Quick-log entries record completed work, so they land as 'Completed' by default
    // — saves the user a follow-up click and matches the workflow ("I ran a cycle and
    // these are the numbers"). They can still archive later.
    if (mode === 'Manual') {
      const cycle = await prisma.testCycle.create({
        data: {
          name,
          description: body.description ?? '',
          projectId: body.projectId,
          mode: 'Manual',
          status: 'Completed',
          // For Manual, scope is irrelevant — default to 'All' (no scopeId required).
          scopeType: 'All',
          scopeId: null,
          targetDate: body.targetDate ? new Date(body.targetDate) : null,
          portalName: body.portalName?.trim() || null,
          moduleName: body.moduleName?.trim() || null,
          featureName: body.featureName?.trim() || null,
          environment: body.environment?.trim() || null,
          platform: body.platform?.trim() || null,
          version: body.version?.trim() || null,
          cycleCategory: body.cycleCategory?.trim() || null,
          ticketLink: body.ticketLink?.trim() || null,
          issueCount: nz(body.issueCount),
          criticalCount: nz(body.criticalCount),
          majorCount: nz(body.majorCount),
          minorCount: nz(body.minorCount),
          doneCount: nz(body.doneCount),
          remainingCount: nz(body.remainingCount),
          passedCount: nz(body.passedCount),
          failedCount: nz(body.failedCount),
          blockedCount: nz(body.blockedCount),
        },
      });
      return ok(cycle, 201);
    }

    // ── CaseBased mode: keep the existing behaviour ──────────────────────
    if (!body?.scopeType || !SCOPE_TYPES.includes(body.scopeType)) {
      return bad(`scopeType must be one of ${SCOPE_TYPES.join('|')}`);
    }

    // Cases attach at portal/module/suite level, so each scope must walk all three
    // attachment points to catch every case at-or-below that node.
    let caseIds: string[] = [];
    if (body.scopeType === 'All') {
      const cases = await prisma.testCase.findMany({
        where: {
          OR: [
            { portal: { projectId: body.projectId } },
            { module: { portal: { projectId: body.projectId } } },
            { suite: { module: { portal: { projectId: body.projectId } } } },
          ],
        },
        select: { id: true },
      });
      caseIds = cases.map(c => c.id);
    } else if (body.scopeType === 'Portal') {
      if (!body.scopeId) return bad('scopeId (portalId) is required for Portal scope');
      const cases = await prisma.testCase.findMany({
        where: {
          OR: [
            { portalId: body.scopeId },
            { module: { portalId: body.scopeId } },
            { suite: { module: { portalId: body.scopeId } } },
          ],
        },
        select: { id: true },
      });
      caseIds = cases.map(c => c.id);
    } else if (body.scopeType === 'Module') {
      if (!body.scopeId) return bad('scopeId (moduleId) is required for Module scope');
      const cases = await prisma.testCase.findMany({
        where: {
          OR: [{ moduleId: body.scopeId }, { suite: { moduleId: body.scopeId } }],
        },
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
        mode: 'CaseBased',
        scopeType: body.scopeType,
        scopeId: body.scopeId ?? null,
        targetDate: body.targetDate ? new Date(body.targetDate) : null,
        // Optional run-context fields — useful even with case-by-case execution.
        environment: body.environment?.trim() || null,
        platform: body.platform?.trim() || null,
        version: body.version?.trim() || null,
        ticketLink: body.ticketLink?.trim() || null,
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

// Non-negative integer or 0
function nz(v: number | undefined | null): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}
