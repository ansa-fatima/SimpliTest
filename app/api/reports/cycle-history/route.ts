import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';
import { parsePeriodParams } from '@/lib/period';
import { loadRunResultClassMap, resultClassOf } from '@/lib/options';

// GET /api/reports/cycle-history
//   ?projectId=&period=&sprintOffset=&portalId=&moduleId=&suiteId=&tester=
//
// Every cycle (quick log or test run) as one row, filterable by the same
// Period/Portal/Module/Feature/Tester dimensions as Stability.
//
// Tester matches TestRun.executedBy for test runs (a cycle counts if ANY of
// its runs was executed by that person) and TestCycle.loggedBy for quick
// logs, both auto-attached from the session at creation time -- a log from
// before loggedBy existed has it blank, so it won't match any tester filter.

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  name: string;
  mode: 'CaseBased' | 'Manual';
  portalName: string | null;
  moduleName: string | null;
  scopeName: string | null;
  version: string | null;
  environment: string | null;
  tester: string;
  date: string;
  issueCount: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  doneCount: number;
  remainingCount: number;
  // Of remainingCount, how many regressed after being marked done -- Jira
  // sync only (see lib/jira.ts). null means "not applicable": an
  // unsynced case-based cycle's breakdown comes from runs[] instead, which
  // has no concept of "reopened".
  reopenedCount: number | null;
};

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const projectId = sp.get('projectId') || undefined;
    const { start: periodStart, end: periodEnd } = parsePeriodParams(sp);
    const portalIdFilter = sp.get('portalId') || undefined;
    const moduleIdFilter = sp.get('moduleId') || undefined;
    const suiteIdFilter = sp.get('suiteId') || undefined;
    const versionFilter = sp.get('version') || undefined;
    const testerFilter = sp.get('tester') || undefined;

    // Effective FailLike classification per run -- covers a workspace-custom
    // RunResult marked FailLike, not just the legacy Failed/Blocked literals
    // (see lib/options.ts). Without a projectId there's no workspace to
    // resolve custom options against, so only the legacy literals apply.
    const resultClassMap = projectId ? await loadRunResultClassMap(projectId) : new Map();
    const isFailLike = (r: { result: string; customResultId: string | null }) =>
      resultClassOf(r, resultClassMap) === 'FailLike';

    // Resolve scope -> portal/module names once, the same way /api/cycles
    // does, so a cycle scoped to a Suite still knows which Portal/Module
    // it's under for both display and filtering.
    const [portals, modules, suites] = await Promise.all([
      prisma.portal.findMany({
        where: projectId ? { projectId } : undefined,
        select: { id: true, name: true },
      }),
      prisma.module.findMany({
        where: projectId ? { portal: { projectId } } : undefined,
        select: { id: true, name: true, portalId: true },
      }),
      prisma.suite.findMany({
        where: projectId ? { module: { portal: { projectId } } } : undefined,
        select: { id: true, name: true, moduleId: true },
      }),
    ]);
    const portalNameById = new Map(portals.map(p => [p.id, p.name]));
    const moduleNameById = new Map(modules.map(m => [m.id, m.name]));
    const modulePortalId = new Map(modules.map(m => [m.id, m.portalId]));
    const suiteNameById = new Map(suites.map(s => [s.id, s.name]));
    const suiteModuleId = new Map(suites.map(s => [s.id, s.moduleId]));

    // Resolve a cycle's scope down to a concrete (portalId, moduleId) pair
    // so filtering and the per-module rollup both have something concrete
    // to key on, regardless of whether the cycle itself is scoped at the
    // Portal, Module, or Suite level.
    const resolveScope = (scopeType: string, scopeId: string | null) => {
      if (scopeType === 'Suite' && scopeId) {
        const moduleId = suiteModuleId.get(scopeId) ?? null;
        return {
          portalId: moduleId ? (modulePortalId.get(moduleId) ?? null) : null,
          moduleId,
          scopeName: suiteNameById.get(scopeId) ?? null,
        };
      }
      if (scopeType === 'Module' && scopeId) {
        return {
          portalId: modulePortalId.get(scopeId) ?? null,
          moduleId: scopeId,
          scopeName: moduleNameById.get(scopeId) ?? null,
        };
      }
      if (scopeType === 'Portal' && scopeId) {
        return {
          portalId: scopeId,
          moduleId: null,
          scopeName: portalNameById.get(scopeId) ?? null,
        };
      }
      return { portalId: null, moduleId: null, scopeName: null };
    };

    const [caseCycles, manualCycles] = await Promise.all([
      prisma.testCycle.findMany({
        where: {
          projectId,
          mode: 'CaseBased',
          ...(versionFilter ? { version: versionFilter } : {}),
        },
        select: {
          id: true,
          name: true,
          status: true,
          scopeType: true,
          scopeId: true,
          version: true,
          environment: true,
          createdAt: true,
          // A case-based cycle can ALSO carry a Jira sync result (see
          // CycleView's Jira panel) -- when it does, that's the source of
          // truth for the breakdown below, same as a Manual quick log's own
          // aggregate fields, instead of the runs[]-derived counts.
          jiraSyncedAt: true,
          issueCount: true,
          criticalCount: true,
          majorCount: true,
          minorCount: true,
          doneCount: true,
          remainingCount: true,
          reopenedCount: true,
          runs: {
            select: {
              result: true,
              customResultId: true,
              executedBy: true,
              wasEverIssue: true,
              testCase: { select: { severity: true, customSeverityId: true } },
            },
          },
        },
      }),
      prisma.testCycle.findMany({
        where: { projectId, mode: 'Manual', ...(versionFilter ? { version: versionFilter } : {}) },
        select: {
          id: true,
          name: true,
          scopeType: true,
          scopeId: true,
          portalName: true,
          moduleName: true,
          featureName: true,
          version: true,
          environment: true,
          issueCount: true,
          criticalCount: true,
          majorCount: true,
          minorCount: true,
          doneCount: true,
          remainingCount: true,
          reopenedCount: true,
          completedAt: true,
          createdAt: true,
          loggedBy: true,
        },
      }),
    ]);

    const rows: Row[] = [];

    for (const c of caseCycles) {
      const { portalId, moduleId, scopeName } = resolveScope(c.scopeType, c.scopeId);
      if (portalIdFilter && portalId !== portalIdFilter) continue;
      if (moduleIdFilter && moduleId !== moduleIdFilter) continue;
      if (suiteIdFilter && c.scopeId !== suiteIdFilter) continue;
      const testers = Array.from(new Set(c.runs.map(r => r.executedBy).filter(Boolean)));
      if (testerFilter && !testers.includes(testerFilter)) continue;

      const date = c.createdAt;
      if (periodStart && date < periodStart) continue;
      if (periodEnd && date >= periodEnd) continue;

      let critical = 0;
      let major = 0;
      let minor = 0;
      let done = 0;
      let remaining = 0;
      let reopened: number | null = null;
      if (c.jiraSyncedAt) {
        // Synced -- the cycle's own aggregate fields are the source of
        // truth (same fields a Manual quick log stores), not the runs[].
        critical = c.criticalCount ?? 0;
        major = c.majorCount ?? 0;
        minor = c.minorCount ?? 0;
        done = c.doneCount ?? 0;
        remaining = c.remainingCount ?? 0;
        reopened = c.reopenedCount ?? 0;
      } else {
        for (const r of c.runs) {
          if (!r.wasEverIssue) continue;
          if (isFailLike(r)) remaining++;
          else done++;
          // A custom-severity case's legacy `severity` column holds an
          // unrelated placeholder value -- skip it here rather than
          // misattributing it, same guard used by /api/cycles and the
          // detailed cycle report.
          if (r.testCase.customSeverityId) continue;
          if (r.testCase.severity === 'Critical') critical++;
          else if (r.testCase.severity === 'Major') major++;
          else if (r.testCase.severity === 'Minor') minor++;
        }
      }

      rows.push({
        id: c.id,
        name: c.name,
        mode: 'CaseBased',
        portalName: portalId ? (portalNameById.get(portalId) ?? null) : null,
        moduleName: moduleId ? (moduleNameById.get(moduleId) ?? null) : null,
        scopeName,
        version: c.version,
        environment: c.environment,
        tester:
          testers.length === 0
            ? ''
            : testers.length === 1
              ? testers[0]
              : `${testers.length} testers`,
        date: date.toISOString(),
        issueCount: done + remaining,
        criticalCount: critical,
        majorCount: major,
        minorCount: minor,
        doneCount: done,
        remainingCount: remaining,
        reopenedCount: reopened,
      });
    }

    for (const log of manualCycles) {
      const { portalId, moduleId, scopeName } = resolveScope(log.scopeType, log.scopeId);
      if (portalIdFilter && portalId !== portalIdFilter) continue;
      if (moduleIdFilter && moduleId !== moduleIdFilter) continue;
      if (suiteIdFilter && log.scopeId !== suiteIdFilter) continue;
      if (testerFilter && log.loggedBy !== testerFilter) continue;

      const date = log.completedAt ?? log.createdAt;
      if (periodStart && date < periodStart) continue;
      if (periodEnd && date >= periodEnd) continue;

      rows.push({
        id: log.id,
        name: log.name,
        mode: 'Manual',
        // Free-text field wins when set (matches /api/cycles' own fallback
        // order); otherwise fall back to whatever the scope resolves to.
        portalName: log.portalName || (portalId ? (portalNameById.get(portalId) ?? null) : null),
        moduleName: log.moduleName || (moduleId ? (moduleNameById.get(moduleId) ?? null) : null),
        scopeName: log.featureName || scopeName,
        version: log.version,
        environment: log.environment,
        tester: log.loggedBy,
        date: date.toISOString(),
        issueCount: log.issueCount ?? 0,
        criticalCount: log.criticalCount ?? 0,
        majorCount: log.majorCount ?? 0,
        minorCount: log.minorCount ?? 0,
        doneCount: log.doneCount ?? 0,
        remainingCount: log.remainingCount ?? 0,
        reopenedCount: log.reopenedCount ?? 0,
      });
    }

    rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return ok({
      cycles: rows,
      totals: {
        totalCycles: rows.length,
        totalIssues: rows.reduce((sum, r) => sum + r.issueCount, 0),
        quickLogCount: rows.filter(r => r.mode === 'Manual').length,
        testRunCount: rows.filter(r => r.mode === 'CaseBased').length,
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
