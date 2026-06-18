import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';

// GET /api/dashboard?projectId=...
// Returns stats + chart data for the home dashboard, optionally scoped to a project.
export async function GET(req: Request) {
  try {
    const projectId = new URL(req.url).searchParams.get('projectId') || undefined;
    const wsCycle = projectId ? { projectId } : {};
    // A test case attaches to portal, module, OR suite directly — match any of the
    // three so the total reflects ALL cases in the workspace, not just suite-anchored ones.
    const wsCase = projectId
      ? {
          OR: [
            { portal: { projectId } },
            { module: { portal: { projectId } } },
            { suite: { module: { portal: { projectId } } } },
          ],
        }
      : {};

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(now.getDate() - 60);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalCases,
      runs30d,
      runsPrev30d,
      openFailures,
      newFailuresToday,
      modules,
      casesByModule,
      allRuns,
      recentCyclesRaw,
    ] = await Promise.all([
      prisma.testCase.count({ where: wsCase }),
      prisma.testRun.findMany({
        where: {
          executedAt: { gte: thirtyDaysAgo },
          NOT: { result: 'NotRun' },
          testCase: wsCase,
        },
        select: {
          result: true,
          executedAt: true,
          testCase: { select: { suite: { select: { module: { select: { name: true } } } } } },
        },
      }),
      prisma.testRun.findMany({
        where: {
          executedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
          NOT: { result: 'NotRun' },
          testCase: wsCase,
        },
        select: { result: true },
      }),
      prisma.testRun.count({
        where: { result: 'Failed', cycle: { status: 'Active', ...wsCycle } },
      }),
      prisma.testRun.count({
        where: { result: 'Failed', executedAt: { gte: todayStart }, cycle: wsCycle },
      }),
      prisma.module.findMany({
        where: projectId ? { portal: { projectId } } : undefined,
        select: {
          id: true,
          name: true,
          // Direct module-attached cases
          testCases: { select: { id: true, runs: { select: { result: true } } } },
          // Plus cases nested in suites below this module
          suites: {
            select: {
              testCases: {
                select: {
                  id: true,
                  runs: { select: { result: true } },
                },
              },
            },
          },
        },
      }),
      prisma.module.findMany({
        where: projectId ? { portal: { projectId } } : undefined,
        select: {
          name: true,
          _count: { select: { testCases: true } },
          suites: { select: { _count: { select: { testCases: true } } } },
        },
      }),
      prisma.testRun.findMany({
        where: { executedAt: { not: null }, cycle: wsCycle },
        select: { result: true, executedAt: true },
      }),
      prisma.testCycle.findMany({
        where: { status: { not: 'Archived' }, ...wsCycle },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          runs: { select: { result: true } },
        },
      }),
    ]);

    // Resolve scope names for recent cycles
    const recentModuleIds = recentCyclesRaw
      .filter(c => c.scopeType === 'Module' && c.scopeId)
      .map(c => c.scopeId!);
    const recentSuiteIds = recentCyclesRaw
      .filter(c => c.scopeType === 'Suite' && c.scopeId)
      .map(c => c.scopeId!);
    const [recentModules, recentSuites] = await Promise.all([
      recentModuleIds.length === 0
        ? Promise.resolve([])
        : prisma.module.findMany({
            where: { id: { in: recentModuleIds } },
            select: { id: true, name: true },
          }),
      recentSuiteIds.length === 0
        ? Promise.resolve([])
        : prisma.suite.findMany({
            where: { id: { in: recentSuiteIds } },
            select: { id: true, name: true, module: { select: { name: true } } },
          }),
    ]);
    const recentModuleMap = new Map(recentModules.map(m => [m.id, m.name]));
    const recentSuiteMap = new Map(recentSuites.map(s => [s.id, `${s.module.name} / ${s.name}`]));

    // Pass rate for 30d window
    const passed30d = runs30d.filter(r => r.result === 'Passed').length;
    const passRate = runs30d.length === 0 ? 0 : Math.round((passed30d / runs30d.length) * 100);

    const passedPrev = runsPrev30d.filter(r => r.result === 'Passed').length;
    const passRatePrev =
      runsPrev30d.length === 0 ? 0 : Math.round((passedPrev / runsPrev30d.length) * 100);

    // 8-week window: bucket by ISO week starting Monday
    const weeks: {
      label: string;
      start: Date;
      end: Date;
      pass: number;
      fail: number;
      blocked: number;
      skipped: number;
    }[] = [];
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    for (let i = 7; i >= 0; i--) {
      const start = new Date(monday);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      weeks.push({ label: `W${8 - i}`, start, end, pass: 0, fail: 0, blocked: 0, skipped: 0 });
    }
    for (const r of allRuns) {
      const t = r.executedAt!;
      const w = weeks.find(w => t >= w.start && t < w.end);
      if (!w) continue;
      if (r.result === 'Passed') w.pass++;
      else if (r.result === 'Failed') w.fail++;
      else if (r.result === 'Blocked') w.blocked++;
      else if (r.result === 'Skipped') w.skipped++;
    }
    const weeklyRuns = weeks.map(w => ({
      label: w.label,
      pass: w.pass,
      fail: w.fail,
      blocked: w.blocked,
      skipped: w.skipped,
    }));

    // Cases by module (donut) — count direct cases plus everything in nested suites.
    const casesByMod = casesByModule
      .map(m => ({
        name: m.name,
        count: m._count.testCases + m.suites.reduce((sum, s) => sum + s._count.testCases, 0),
      }))
      .filter(m => m.count > 0);

    // Module stability — pass rate per module across all (non-NotRun) runs.
    // Walks direct module cases AND cases nested in this module's suites.
    // Filtered to modules that actually have runs — empty bars are noise.
    const moduleStability = modules
      .map(m => {
        let total = 0,
          passed = 0;
        const walkCase = (runs: { result: string }[]) => {
          for (const r of runs) {
            if (r.result === 'NotRun') continue;
            total++;
            if (r.result === 'Passed') passed++;
          }
        };
        for (const tc of m.testCases) walkCase(tc.runs);
        for (const s of m.suites) {
          for (const tc of s.testCases) walkCase(tc.runs);
        }
        const passRate = total === 0 ? null : Math.round((passed / total) * 100);
        return { name: m.name, passRate, totalRuns: total };
      })
      .filter(m => m.totalRuns > 0);

    // Recent cycles with per-cycle progress + scope name
    const recentCycles = recentCyclesRaw.map(c => {
      const counts = { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
      for (const r of c.runs) counts[r.result]++;
      const total = c.runs.length;
      const done = total - counts.NotRun;
      const passRate = total === 0 ? 0 : Math.round((counts.Passed / total) * 100);

      let scopeName: string | null = null;
      if (c.scopeType === 'All') scopeName = 'All test cases';
      else if (c.scopeType === 'Custom') scopeName = 'Custom selection';
      else if (c.scopeType === 'Module' && c.scopeId)
        scopeName = recentModuleMap.get(c.scopeId) ?? null;
      else if (c.scopeType === 'Suite' && c.scopeId)
        scopeName = recentSuiteMap.get(c.scopeId) ?? null;

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        scopeType: c.scopeType,
        scopeName,
        createdAt: c.createdAt,
        total,
        done,
        passRate,
        counts,
      };
    });

    return ok({
      totalCases,
      runs30d: { total: runs30d.length, prev: runsPrev30d.length },
      passRate: { current: passRate, prev: passRatePrev, delta: passRate - passRatePrev },
      openFailures: { total: openFailures, newToday: newFailuresToday },
      weeklyRuns,
      casesByModule: casesByMod,
      moduleStability,
      recentCycles,
    });
  } catch (e) {
    return serverError(e);
  }
}
