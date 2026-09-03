import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';

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

type DataPoint = {
  pass: boolean;
  // 0–1 credit this point contributes to the pass rate. Binary (0 or 1) for
  // a test case run, but a tracked quick log gets partial credit for partial
  // resolution — 6 of 8 issues done reads as 75%, not a flat 0% just because
  // it isn't fully resolved yet.
  score: number;
  ts: Date;
  cycleId: string;
  cycleName: string;
  kind: 'quicklog' | 'caserun';
  label: string;
  detail: string;
};

function stats(points: DataPoint[]) {
  const total = points.length;
  // "Passed"/"failed" stay binary counts (how many points are fully clean) —
  // it's passRate that's now the average of each point's partial-credit
  // score, so a module with several half-resolved quick logs reads as
  // meaningfully better than 0% instead of just "failed".
  const passed = points.filter(p => p.pass).length;
  const failed = total - passed;
  const passRate =
    total === 0 ? 0 : Math.round((points.reduce((sum, p) => sum + p.score, 0) / total) * 100);
  const label: 'Stable' | 'At Risk' | 'Unstable' | 'No data' =
    total === 0 ? 'No data' : passRate >= 90 ? 'Stable' : passRate >= 70 ? 'At Risk' : 'Unstable';
  const lastActivity = total === 0 ? null : new Date(Math.max(...points.map(p => p.ts.getTime())));

  // Trend: compare the average score of the earlier half of data points to
  // the later half. Needs at least 4 points to say anything meaningful.
  let trend: 'up' | 'down' | 'flat' = 'flat';
  if (total >= 4) {
    const sorted = [...points].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    const mid = Math.floor(sorted.length / 2);
    const rateOf = (arr: DataPoint[]) =>
      arr.length === 0 ? 0 : (arr.reduce((sum, p) => sum + p.score, 0) / arr.length) * 100;
    const diff = rateOf(sorted.slice(mid)) - rateOf(sorted.slice(0, mid));
    trend = diff >= 5 ? 'up' : diff <= -5 ? 'down' : 'flat';
  }

  const logs = [...points]
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

  return { total, passed, failed, passRate, label, trend, lastActivity, logs };
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

    const [portals, runs, quickLogs] = await Promise.all([
      prisma.portal.findMany({
        where: projectId ? { projectId } : undefined,
        include: { modules: { include: { suites: true }, orderBy: { name: 'asc' } } },
        orderBy: { name: 'asc' },
      }),
      prisma.testRun.findMany({
        where: {
          cycle: { projectId, mode: 'CaseBased' },
          result: { in: ['Passed', 'Failed'] },
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
      const point: DataPoint = {
        pass: r.result === 'Passed',
        score: r.result === 'Passed' ? 1 : 0,
        ts: r.executedAt ?? r.updatedAt,
        cycleId: r.cycleId,
        cycleName: r.cycle.name,
        kind: 'caserun',
        label: r.testCase.title,
        detail: `${r.result} · ${r.cycle.name}`,
      };
      if (r.testCase.suiteId) pushTo(suitePoints, r.testCase.suiteId, point);
      else if (r.testCase.moduleId) pushTo(moduleDirectPoints, r.testCase.moduleId, point);
    }
    for (const log of quickLogs) {
      if (!log.scopeId) continue;
      // Done/Remaining are only meaningful once someone has actually filled
      // them in (e.g. re-opening this cycle after a retest) — untouched,
      // both default to 0, which must NOT read as "nothing remains". Once
      // they ARE tracked, they're the live truth: a cycle that originally
      // found 8 issues but was edited to 0 remaining is a genuine pass now,
      // even though issueCount (what was found) still says 8. Untracked
      // cycles keep the original "found nothing" rule.
      const done = log.doneCount ?? 0;
      const remaining = log.remainingCount ?? 0;
      const tracked = done > 0 || remaining > 0;
      const issuesOpen = tracked ? remaining > 0 : (log.issueCount ?? 0) > 0;
      // A log can separately record real Failed/Blocked test-case results
      // even once its own issue tracking says fully resolved — those still
      // count as a fail here, same rule the Quick Log Summary modal already
      // uses. Without this, a log with 3 failed cases but "issues: done"
      // read as a Pass here while its own summary called it Failed.
      const hasCaseFailure = (log.failedCount ?? 0) > 0 || (log.blockedCount ?? 0) > 0;
      const pass = !issuesOpen && !hasCaseFailure;
      // A tracked log (and no case failure) gets partial credit for partial
      // resolution (6 of 8 done = 0.75) instead of an all-or-nothing 0/1 —
      // that's the whole point of tracking Done/Remaining rather than just
      // Pass/Fail.
      const score = tracked && !hasCaseFailure ? done / (done + remaining) : pass ? 1 : 0;
      let detail: string;
      if (pass) {
        detail = tracked ? `Pass · ${done} issue${done === 1 ? '' : 's'} resolved` : 'Pass';
      } else if (hasCaseFailure) {
        detail = `Fail · ${log.failedCount ?? 0} failed, ${log.blockedCount ?? 0} blocked`;
      } else if (tracked) {
        const total = done + remaining;
        detail = `Fail · ${remaining} of ${total} issue${total === 1 ? '' : 's'} still open`;
      } else {
        detail = `Fail · ${log.issueCount} issue${log.issueCount === 1 ? '' : 's'}`;
      }
      const point: DataPoint = {
        pass,
        score,
        ts: log.completedAt ?? log.createdAt,
        cycleId: log.id,
        cycleName: log.name,
        kind: 'quicklog',
        label: log.name,
        detail,
      };
      if (log.scopeType === 'Suite') pushTo(suitePoints, log.scopeId, point);
      else if (log.scopeType === 'Module') pushTo(moduleDirectPoints, log.scopeId, point);
    }

    let stable = 0,
      atRisk = 0,
      unstable = 0,
      noData = 0;
    const allPoints: DataPoint[] = [];

    const portalRows = portals.map(p => {
      const moduleRows = p.modules.map(m => {
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
          return { id: s.id, name: s.name, parentId: s.parentId, ...stats(points) };
        });

        // Module rollup = its own direct cases/logs + every suite under it (any depth).
        const modulePoints = [
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
          suites: suiteRows.sort((a, b) => riskRank(a) - riskRank(b)),
        };
      });

      return {
        id: p.id,
        name: p.name,
        icon: p.icon,
        modules: moduleRows.sort((a, b) => riskRank(a) - riskRank(b)),
      };
    });

    const overall = stats(allPoints);

    return ok({
      portals: portalRows,
      totals: {
        totalDataPoints: overall.total,
        overallPassRate: overall.passRate,
        modules: { stable, atRisk, unstable, noData },
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
