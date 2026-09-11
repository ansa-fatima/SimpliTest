import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';
import { parsePeriodParams } from '@/lib/period';

// GET /api/reports/cycle-history
//   ?projectId=&period=&sprintOffset=&portalId=&moduleId=&suiteId=&tester=
//
// Every cycle (quick log or test run) as one row, filterable by the same
// Period/Portal/Module/Feature/Tester dimensions as Stability, plus a
// "cycles per module" rollup answering the review's "how many cycles ran
// against this module/feature" ask directly.
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
  tester: string;
  date: string;
  issueCount: number;
  status: 'Active' | 'Pass' | 'Fail';
};

function manualVerdict(log: {
  issueCount: number | null;
  doneCount?: number | null;
  remainingCount?: number | null;
  failedCount?: number | null;
  blockedCount?: number | null;
}): 'Pass' | 'Fail' {
  // Same tracked/untracked + case-failure rule as the Quick Log Summary
  // modal, the Dashboard, and the Stability report -- kept here as its own
  // small copy rather than a shared import, since this route already has
  // several other cycle-history-specific concerns; worth consolidating if
  // a fifth place ever needs this same rule.
  const done = log.doneCount ?? 0;
  const remaining = log.remainingCount ?? 0;
  const tracked = done > 0 || remaining > 0;
  const issuesOpen = tracked ? remaining > 0 : (log.issueCount ?? 0) > 0;
  const hasCaseFailure = (log.failedCount ?? 0) > 0 || (log.blockedCount ?? 0) > 0;
  return !issuesOpen && !hasCaseFailure ? 'Pass' : 'Fail';
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const projectId = sp.get('projectId') || undefined;
    const { start: periodStart, end: periodEnd } = parsePeriodParams(sp);
    const portalIdFilter = sp.get('portalId') || undefined;
    const moduleIdFilter = sp.get('moduleId') || undefined;
    const suiteIdFilter = sp.get('suiteId') || undefined;
    const testerFilter = sp.get('tester') || undefined;

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
        where: { projectId, mode: 'CaseBased' },
        select: {
          id: true,
          name: true,
          status: true,
          scopeType: true,
          scopeId: true,
          createdAt: true,
          runs: { select: { result: true, executedBy: true, wasEverIssue: true } },
        },
      }),
      prisma.testCycle.findMany({
        where: { projectId, mode: 'Manual' },
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

      const issueCount = c.runs.filter(r => r.wasEverIssue).length;
      const openIssues = c.runs.filter(r => r.result === 'Failed' || r.result === 'Blocked').length;
      const status: Row['status'] =
        c.status === 'Active' ? 'Active' : openIssues === 0 ? 'Pass' : 'Fail';

      rows.push({
        id: c.id,
        name: c.name,
        mode: 'CaseBased',
        portalName: portalId ? (portalNameById.get(portalId) ?? null) : null,
        moduleName: moduleId ? (moduleNameById.get(moduleId) ?? null) : null,
        scopeName,
        tester:
          testers.length === 0
            ? ''
            : testers.length === 1
              ? testers[0]
              : `${testers.length} testers`,
        date: date.toISOString(),
        issueCount,
        status,
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
        tester: log.loggedBy,
        date: date.toISOString(),
        issueCount: log.issueCount ?? 0,
        status: manualVerdict(log),
      });
    }

    rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const cyclesPerModule = new Map<string, number>();
    for (const r of rows) {
      const key = r.moduleName ?? 'Unscoped';
      cyclesPerModule.set(key, (cyclesPerModule.get(key) ?? 0) + 1);
    }

    return ok({
      cycles: rows,
      totals: {
        totalCycles: rows.length,
        totalIssues: rows.reduce((sum, r) => sum + r.issueCount, 0),
        quickLogCount: rows.filter(r => r.mode === 'Manual').length,
        testRunCount: rows.filter(r => r.mode === 'CaseBased').length,
      },
      cyclesPerModule: Array.from(cyclesPerModule.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (e) {
    return serverError(e);
  }
}
