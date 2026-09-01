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
  ts: Date;
  cycleId: string;
  cycleName: string;
  kind: 'quicklog' | 'caserun';
  label: string;
  detail: string;
};

function stats(points: DataPoint[]) {
  const total = points.length;
  const passed = points.filter(p => p.pass).length;
  const failed = total - passed;
  const passRate = total === 0 ? 0 : Math.round((passed / total) * 100);
  const label: 'Stable' | 'At Risk' | 'Unstable' | 'No data' =
    total === 0 ? 'No data' : passRate >= 90 ? 'Stable' : passRate >= 70 ? 'At Risk' : 'Unstable';
  const lastActivity = total === 0 ? null : new Date(Math.max(...points.map(p => p.ts.getTime())));

  // Trend: compare the pass rate of the earlier half of data points to the
  // later half. Needs at least 4 points to say anything meaningful.
  let trend: 'up' | 'down' | 'flat' = 'flat';
  if (total >= 4) {
    const sorted = [...points].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    const mid = Math.floor(sorted.length / 2);
    const rateOf = (arr: DataPoint[]) =>
      arr.length === 0 ? 0 : (arr.filter(p => p.pass).length / arr.length) * 100;
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
      ts: p.ts.toISOString(),
    }));

  return { total, passed, failed, passRate, label, trend, lastActivity, logs };
}

// Sort worst-first (lowest pass rate), pushing "No data" rows to the bottom —
// gaps aren't "bad", they're just unmeasured, so they shouldn't hide real risk.
function riskRank(s: ReturnType<typeof stats>) {
  return s.total === 0 ? 1000 : s.passRate;
}

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
      const pass = (log.issueCount ?? 0) === 0;
      const point: DataPoint = {
        pass,
        ts: log.completedAt ?? log.createdAt,
        cycleId: log.id,
        cycleName: log.name,
        kind: 'quicklog',
        label: log.name,
        detail: pass ? 'Pass' : `Fail · ${log.issueCount} issue${log.issueCount === 1 ? '' : 's'}`,
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
