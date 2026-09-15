import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';
import { parsePeriodParams } from '@/lib/period';
import { DataPoint, pointFromRun, pointFromQuickLog, stats } from '@/lib/stability';

// GET /api/reports/stability
//   ?projectId=...
//
// "How stable is this module/feature?" — blends two signals into one rolling
// pass rate per Module and per Suite (feature):
//   • CaseBased test runs: each executed TestRun (Passed/Failed) is one data point.
//   • Manual quick logs: each quick log is one data point, using its own
//     Pass/Fail verdict (issueCount === 0 → Pass), same rule the Dashboard's
//     Recent Activity list already uses.
// Blocked/Skipped/NotRun runs aren't a verdict on stability, so they're excluded.
//
// A Suite's row includes its own direct data PLUS all of its nested child
// suites (suites can nest arbitrarily). A Module's row includes its own
// direct-attached cases/logs PLUS every suite under it (any depth).
//
// Each data point also carries its source cycleId + a label, so the UI can
// let a user click through from a stat straight to the underlying log/run.

// Per-log drill-down list — Stability-report-specific (Dashboard's shared
// `stats()` doesn't need this, so it stays local rather than in lib/stability).
function buildLogs(points: DataPoint[]) {
  return [...points]
    .sort((a, b) => b.ts.getTime() - a.ts.getTime())
    .map(p => ({
      cycleId: p.cycleId,
      cycleName: p.cycleName,
      kind: p.kind,
      label: p.label,
      detail: p.detail,
      pass: p.pass,
      score: p.score,
      ts: p.ts.toISOString(),
    }));
}

// Sort worst-first (lowest pass rate), pushing "No data" rows to the bottom —
// gaps aren't "bad", they're just unmeasured, so they shouldn't hide real risk.
function riskRank(s: ReturnType<typeof stats>) {
  return s.total === 0 ? 1000 : s.passRate;
}

// Never statically cache — see the same note in /api/dashboard.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const projectId = sp.get('projectId') || undefined;
    const { period, sprintOffset, start: periodStart, end: periodEnd } = parsePeriodParams(sp);

    // Scope filters — Portal and Module narrow the DB query itself (cheap,
    // and safe since neither one nests). Suite (Feature) can't be filtered
    // at this level: suites nest arbitrarily, and a suite's own rollup needs
    // every descendant still present to walk, so it's applied after — see
    // targetSuiteRow below.
    const portalIdFilter = sp.get('portalId') || undefined;
    const moduleIdFilter = sp.get('moduleId') || undefined;
    const suiteIdFilter = sp.get('suiteId') || undefined;
    const versionFilter = sp.get('version') || undefined;
    const testerFilter = sp.get('tester') || undefined;

    const [portals, runs, quickLogs] = await Promise.all([
      prisma.portal.findMany({
        where: {
          ...(projectId ? { projectId } : {}),
          ...(portalIdFilter ? { id: portalIdFilter } : {}),
        },
        include: {
          modules: {
            where: moduleIdFilter ? { id: moduleIdFilter } : undefined,
            include: { suites: true },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.testRun.findMany({
        where: {
          cycle: {
            projectId,
            mode: 'CaseBased',
            ...(versionFilter ? { version: versionFilter } : {}),
          },
          result: { in: ['Passed', 'Failed'] },
          ...(testerFilter ? { executedBy: testerFilter } : {}),
        },
        select: {
          result: true,
          executedAt: true,
          updatedAt: true,
          cycleId: true,
          cycle: { select: { name: true } },
          testCase: { select: { title: true, moduleId: true, suiteId: true } },
        },
      }),
      prisma.testCycle.findMany({
        where: {
          projectId,
          mode: 'Manual',
          scopeType: { in: ['Module', 'Suite'] },
          scopeId: { not: null },
          ...(versionFilter ? { version: versionFilter } : {}),
          ...(testerFilter ? { loggedBy: testerFilter } : {}),
        },
        select: {
          id: true,
          name: true,
          scopeType: true,
          scopeId: true,
          issueCount: true,
          doneCount: true,
          remainingCount: true,
          failedCount: true,
          blockedCount: true,
          completedAt: true,
          createdAt: true,
        },
      }),
    ]);

    const moduleDirectPoints = new Map<string, DataPoint[]>();
    const suitePoints = new Map<string, DataPoint[]>();
    const pushTo = (map: Map<string, DataPoint[]>, key: string, point: DataPoint) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(point);
    };

    for (const r of runs) {
      const point = pointFromRun(r);
      if (periodStart && point.ts < periodStart) continue;
      if (periodEnd && point.ts >= periodEnd) continue;
      if (r.testCase.suiteId) pushTo(suitePoints, r.testCase.suiteId, point);
      else if (r.testCase.moduleId) pushTo(moduleDirectPoints, r.testCase.moduleId, point);
    }
    for (const log of quickLogs) {
      if (!log.scopeId) continue;
      const point = pointFromQuickLog(log);
      if (periodStart && point.ts < periodStart) continue;
      if (periodEnd && point.ts >= periodEnd) continue;
      if (log.scopeType === 'Suite') pushTo(suitePoints, log.scopeId, point);
      else if (log.scopeType === 'Module') pushTo(moduleDirectPoints, log.scopeId, point);
    }
    let stable = 0,
      atRisk = 0,
      unstable = 0,
      noData = 0;
    const allPoints: DataPoint[] = [];

    const portalRows = portals.map(p => {
      const moduleRowsRaw = p.modules.map(m => {
        // Nested suites: build parent → children so a suite's row rolls up
        // its own descendants, not just its direct data.
        const childrenOf = new Map<string, string[]>();
        for (const s of m.suites) {
          const key = s.parentId ?? '__root__';
          if (!childrenOf.has(key)) childrenOf.set(key, []);
          childrenOf.get(key)!.push(s.id);
        }
        const collectDescendants = (id: string): string[] => [
          id,
          ...(childrenOf.get(id) ?? []).flatMap(collectDescendants),
        ];

        const suiteRows = m.suites.map(s => {
          const ids = collectDescendants(s.id);
          const points = ids.flatMap(id => suitePoints.get(id) ?? []);
          return {
            id: s.id,
            name: s.name,
            parentId: s.parentId,
            ...stats(points),
            logs: buildLogs(points),
          };
        });

        // A specific Feature (suite) selected: that suite's own rollup
        // represents this module everywhere below — row list AND the KPI
        // totals — not the whole module diluted by its siblings. "Show me
        // just this feature" should mean exactly that. Suite filtering
        // can't happen earlier (in the DB query) because suites nest
        // arbitrarily and collectDescendants needs every sibling present
        // to walk correctly — it's applied here, after rollups are built.
        const targetSuiteRow = suiteIdFilter
          ? suiteRows.find(s => s.id === suiteIdFilter)
          : undefined;
        if (suiteIdFilter && !targetSuiteRow) return null; // this module doesn't contain the selected feature

        const modulePoints = targetSuiteRow
          ? collectDescendants(suiteIdFilter!).flatMap(id => suitePoints.get(id) ?? [])
          : [
              ...(moduleDirectPoints.get(m.id) ?? []),
              ...m.suites.flatMap(s => suitePoints.get(s.id) ?? []),
            ];
        allPoints.push(...modulePoints);
        const moduleStats = stats(modulePoints);
        if (moduleStats.label === 'Stable') stable++;
        else if (moduleStats.label === 'At Risk') atRisk++;
        else if (moduleStats.label === 'Unstable') unstable++;
        else noData++;

        return {
          id: m.id,
          name: m.name,
          ...moduleStats,
          logs: buildLogs(modulePoints),
          suites: (targetSuiteRow ? [targetSuiteRow] : suiteRows).sort(
            (a, b) => riskRank(a) - riskRank(b),
          ),
        };
      });
      const moduleRows = moduleRowsRaw.filter((m): m is NonNullable<typeof m> => m !== null);

      return {
        id: p.id,
        name: p.name,
        icon: p.icon,
        modules: moduleRows.sort((a, b) => riskRank(a) - riskRank(b)),
      };
    });

    const overall = stats(allPoints);

    // Once Module or Feature narrows things down, a portal with zero
    // surviving modules isn't telling you anything real about that portal
    // — it's just noise from the filter, unlike an actually-empty portal in
    // the unfiltered view, which is worth showing as "No modules".
    const portalRowsToReturn =
      moduleIdFilter || suiteIdFilter ? portalRows.filter(p => p.modules.length > 0) : portalRows;

    return ok({
      portals: portalRowsToReturn,
      totals: {
        totalDataPoints: overall.total,
        overallPassRate: overall.passRate,
        modules: { stable, atRisk, unstable, noData },
      },
      period,
      periodStart: periodStart ? periodStart.toISOString() : null,
      periodEnd: periodEnd ? periodEnd.toISOString() : null,
      sprintOffset,
    });
  } catch (e) {
    return serverError(e);
  }
}
