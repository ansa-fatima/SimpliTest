import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { ok, serverError } from '@/lib/api';
import { DataPoint, pointFromRun, pointFromQuickLog, stats } from '@/lib/stability';
import {
  loadRunResultClassMap,
  runResultClassWhereClause,
  stabilityResultWhereClause,
} from '@/lib/options';

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
    const passFailFilter: Prisma.TestRunWhereInput = projectId
      ? await stabilityResultWhereClause(projectId)
      : { result: { in: ['Passed', 'Failed'] } };
    const failLikeFilter: Prisma.TestRunWhereInput = projectId
      ? await runResultClassWhereClause(projectId, ['FailLike'])
      : { result: { in: ['Failed', 'Blocked'] } };
    const resultClassMap = projectId ? await loadRunResultClassMap(projectId) : new Map();

    const [
      completedCycles,
      totalLoggedEntries,
      caseCycles,
      manualLogs,
      runs,
      recurringRuns,
      jiraSubIssues,
    ] = await Promise.all([
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
          moduleName: true,
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
        where: { cycle: { mode: 'CaseBased', ...wsCycle }, ...passFailFilter },
        select: {
          result: true,
          customResultId: true,
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
          ...failLikeFilter,
          executedAt: { not: null },
          cycle: wsCycle,
        },
        select: { testCaseId: true, cycleId: true },
      }),
      // Reopened Jira tickets -- same "sum each cycle's own timesReopened
      // per issueKey" rule as /api/reports/recurring-issues, just counted
      // here rather than listed. Workspace-wide like that report's own
      // Jira signal, not scoped by module/version/tester.
      projectId
        ? prisma.jiraSubIssue.findMany({
            where: { projectId },
            select: { issueKey: true, isReopened: true, timesReopened: true },
          })
        : Promise.resolve([]),
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
      const point = pointFromRun(r, resultClassMap);
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

    // Reopened Jira tickets -- sum each cycle's own persistent
    // timesReopened per issueKey (see JiraSubIssue.timesReopened), same
    // number /api/reports/recurring-issues' Reopened tab and the Cycle
    // History info modal's "Reopened Nx" badge already show.
    const reopenedByKey = new Map<string, number>();
    for (const s of jiraSubIssues) {
      // Floor of 1 when isReopened is true but timesReopened hasn't caught
      // up yet (a row synced before that field existed) -- same fallback
      // the Cycle History info modal's badge and the Reopened tab use.
      const count = Math.max(s.timesReopened, s.isReopened ? 1 : 0);
      reopenedByKey.set(s.issueKey, (reopenedByKey.get(s.issueKey) ?? 0) + count);
    }
    const jiraReopenedCount = Array.from(reopenedByKey.values()).filter(n => n >= 1).length;

    return ok({
      completedCycles,
      avgPassRate: overall.passRate,
      avgExecutionRate: executionRate,
      avgModuleStability,
      openQuickLogIssues,
      // Recurring (test cases) + Reopened (Jira) -- exactly the two tabs
      // the Recurring Issues report itself has, so this landing-page number
      // always adds up to what clicking through actually shows.
      recurringIssuesTotal: recurringCaseCount + jiraReopenedCount,
      totalLoggedEntries,
    });
  } catch (e) {
    return serverError(e);
  }
}
