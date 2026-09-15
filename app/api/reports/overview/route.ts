import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';
import { DataPoint, pointFromRun, pointFromQuickLog, stats } from '@/lib/stability';

export const dynamic = 'force-dynamic';

// GET /api/reports/overview
//   ?projectId=
//
// Six blended, workspace-wide numbers for the Reports landing page's "At a
// Glance" row, plus one highlight stat per report card ("Jump to a
// Report") — each of those highlights is the exact same number its own
// report leads with, so the landing page never promises something the
// report itself doesn't back up.

function quickLogOpen(log: {
  issueCount: number | null;
  doneCount: number | null;
  remainingCount: number | null;
}): boolean {
  const done = log.doneCount ?? 0;
  const remaining = log.remainingCount ?? 0;
  const tracked = done > 0 || remaining > 0;
  return tracked ? remaining > 0 : (log.issueCount ?? 0) > 0;
}

export async function GET(req: Request) {
  try {
    const projectId = new URL(req.url).searchParams.get('projectId') || undefined;
    const wsCycle = projectId ? { projectId } : {};

    const [completedCycles, totalLoggedEntries, caseCycles, manualLogs, runs, recurringRuns] =
      await Promise.all([
        prisma.testCycle.count({ where: { mode: 'CaseBased', status: 'Completed', ...wsCycle } }),
        prisma.testCycle.count({ where: { ...wsCycle } }),
        // Execution rate needs each cycle's own done/total, not a workspace
        // total — a 500-case cycle and a 3-case cycle should count equally
        // toward the average, the same way a per-module average would.
        prisma.testCycle.findMany({
          where: { mode: 'CaseBased', ...wsCycle },
          select: { runs: { select: { result: true } } },
        }),
        prisma.testCycle.findMany({
          where: { mode: 'Manual', ...wsCycle },
          select: {
            id: true,
            name: true,
            scopeType: true,
            scopeId: true,
            portalName: true,
            moduleName: true,
            featureName: true,
            issueCount: true,
            doneCount: true,
            remainingCount: true,
            failedCount: true,
            blockedCount: true,
            completedAt: true,
            createdAt: true,
          },
        }),
        // Blended pass rate -- same two signals + same rule Dashboard and
        // Stability already use (see lib/stability.ts), unfiltered here since
        // this is a workspace-wide headline number, not a drill-down.
        prisma.testRun.findMany({
          where: { cycle: { mode: 'CaseBased', ...wsCycle }, result: { in: ['Passed', 'Failed'] } },
          select: {
            result: true,
            executedAt: true,
            updatedAt: true,
            cycleId: true,
            cycle: { select: { name: true } },
            testCase: {
              select: {
                title: true,
                moduleId: true,
                suiteId: true,
                module: { select: { name: true } },
                suite: { select: { module: { select: { name: true } } } },
              },
            },
          },
        }),
        // Recurring test cases -- same "Failed/Blocked in 2+ distinct cycles"
        // rule as /api/reports/recurring-issues, just counted here rather
        // than listed.
        prisma.testRun.findMany({
          where: {
            result: { in: ['Failed', 'Blocked'] },
            executedAt: { not: null },
            cycle: wsCycle,
          },
          select: { testCaseId: true, cycleId: true },
        }),
      ]);

    // Execution rate: average, across CaseBased cycles that have at least
    // one run, of how much of that cycle's cases have been executed.
    const cyclesWithRuns = caseCycles.filter(c => c.runs.length > 0);
    const executionRate =
      cyclesWithRuns.length === 0
        ? 0
        : Math.round(
            (cyclesWithRuns.reduce((sum, c) => {
              const done = c.runs.filter(r => r.result !== 'NotRun').length;
              return sum + done / c.runs.length;
            }, 0) /
              cyclesWithRuns.length) *
              100,
          );

    // Blended overall pass rate (flat, every data point weighted equally)
    // and per-module average (each module weighted equally instead) --
    // these read differently on purpose: a few very active modules can't
    // drown out the rest in the per-module average the way they would in
    // the flat blend.
    const moduleDirectPoints = new Map<string, DataPoint[]>();
    for (const r of runs) {
      const point = pointFromRun(r);
      // A case attaches to a module directly OR via a suite -- resolve
      // whichever one holds it so a suite's cases roll up under their real
      // parent module instead of landing in a separate bucket keyed by suite id.
      const key = r.testCase.suite?.module.name ?? r.testCase.module?.name;
      if (!key) continue;
      if (!moduleDirectPoints.has(key)) moduleDirectPoints.set(key, []);
      moduleDirectPoints.get(key)!.push(point);
    }
    for (const log of manualLogs) {
      if (!log.moduleName) continue;
      const point = pointFromQuickLog(log);
      if (!moduleDirectPoints.has(log.moduleName)) moduleDirectPoints.set(log.moduleName, []);
      moduleDirectPoints.get(log.moduleName)!.push(point);
    }
    const allPoints = Array.from(moduleDirectPoints.values()).flat();
    const overall = stats(allPoints);
    const moduleRates = Array.from(moduleDirectPoints.values())
      .map(points => stats(points))
      .filter(s => s.total > 0);
    const avgModuleStability =
      moduleRates.length === 0
        ? 0
        : Math.round(moduleRates.reduce((sum, s) => sum + s.passRate, 0) / moduleRates.length);

    const openQuickLogIssues = manualLogs.filter(quickLogOpen).length;

    // Recurring test cases -- 2+ distinct cycles.
    const casesByCycles = new Map<string, Set<string>>();
    for (const r of recurringRuns) {
      if (!casesByCycles.has(r.testCaseId)) casesByCycles.set(r.testCaseId, new Set());
      casesByCycles.get(r.testCaseId)!.add(r.cycleId);
    }
    const recurringCaseCount = Array.from(casesByCycles.values()).filter(s => s.size >= 2).length;

    // Recurring QL suites -- same scope-key + "issueCount > 0 in 2+ separate
    // logs" rule as /api/reports/recurring-issues used before it was
    // trimmed down to just the case list; recomputed here since this
    // landing stat is the only place that still needs the count.
    const qlGroups = new Map<string, number>();
    for (const log of manualLogs) {
      if ((log.issueCount ?? 0) <= 0) continue;
      const key =
        log.scopeId ??
        `free:${log.portalName ?? ''}|${log.moduleName ?? ''}|${log.featureName ?? ''}`;
      qlGroups.set(key, (qlGroups.get(key) ?? 0) + 1);
    }
    const recurringQlSuiteCount = Array.from(qlGroups.values()).filter(n => n >= 2).length;

    return ok({
      completedCycles,
      avgPassRate: overall.passRate,
      avgExecutionRate: executionRate,
      avgModuleStability,
      openQuickLogIssues,
      recurringIssuesTotal: recurringCaseCount + recurringQlSuiteCount,
      totalLoggedEntries,
    });
  } catch (e) {
    return serverError(e);
  }
}
