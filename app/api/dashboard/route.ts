import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';

// Always compute fresh from the database. Without this, Next.js can decide
// this GET handler has no per-request dependencies (it only reads a
// same-value-every-time `projectId` query param) and cache the whole route,
// which is exactly wrong for a dashboard whose entire point is showing the
// latest test activity the instant it happens.
export const dynamic = 'force-dynamic';

// GET /api/dashboard?projectId=...
// Returns stats + chart data for the home dashboard, optionally scoped to a project.
//
// Every metric here blends two signals, same convention as the Stability
// report: CaseBased TestRuns (Passed/Failed) AND Manual quick logs, using the
// same tracked/untracked Done-Remaining rule (see logPass below) — a
// workspace that's mostly quick-logged would otherwise show 0% everywhere
// despite plenty of real activity.
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
      allRuns,
      manualLogs,
      recentCyclesRaw,
    ] = await Promise.all([
      prisma.testCase.count({ where: wsCase }),
      prisma.testRun.findMany({
        where: {
          executedAt: { gte: thirtyDaysAgo },
          NOT: { result: 'NotRun' },
          testCase: wsCase,
        },
        select: { result: true, executedAt: true },
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
        where: {
          result: 'Failed',
          executedAt: { gte: todayStart },
          cycle: { status: 'Active', ...wsCycle },
        },
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
              id: true,
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
      prisma.testRun.findMany({
        where: { executedAt: { not: null }, cycle: wsCycle },
        select: { result: true, executedAt: true },
      }),
      // All Manual (quick-log) cycles — reused for the 30d pass rate, the 8-week
      // trend, and per-module stability. Unwindowed here; each derivation below
      // filters by date itself.
      prisma.testCycle.findMany({
        where: { mode: 'Manual', ...wsCycle },
        select: {
          completedAt: true,
          createdAt: true,
          issueCount: true,
          doneCount: true,
          remainingCount: true,
          failedCount: true,
          blockedCount: true,
          scopeType: true,
          scopeId: true,
        },
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
    const recentPortalIds = recentCyclesRaw
      .filter(c => c.scopeType === 'Portal' && c.scopeId)
      .map(c => c.scopeId!);
    const recentModuleIds = recentCyclesRaw
      .filter(c => c.scopeType === 'Module' && c.scopeId)
      .map(c => c.scopeId!);
    const recentSuiteIds = recentCyclesRaw
      .filter(c => c.scopeType === 'Suite' && c.scopeId)
      .map(c => c.scopeId!);
    const [recentPortals, recentModules, recentSuites] = await Promise.all([
      recentPortalIds.length === 0
        ? Promise.resolve([])
        : prisma.portal.findMany({
            where: { id: { in: recentPortalIds } },
            select: { id: true, name: true },
          }),
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
    const recentPortalMap = new Map(recentPortals.map(p => [p.id, p.name]));
    const recentModuleMap = new Map(recentModules.map(m => [m.id, m.name]));
    const recentSuiteMap = new Map(recentSuites.map(s => [s.id, `${s.module.name} / ${s.name}`]));

    const logTs = (l: { completedAt: Date | null; createdAt: Date }) =>
      l.completedAt ?? l.createdAt;
    // Same rule as the Stability report and the Quick Log Summary modal:
    // once a log's Done/Remaining counts have actually been touched, the
    // live Remaining count decides pass/fail — not the frozen original
    // issueCount — so a fully-resolved cycle reads as a pass here too
    // instead of staying stuck as a fail forever. A log can also separately
    // record real Failed/Blocked test-case results even once its issues are
    // marked resolved — those still count as a fail, or a log with 3 failed
    // cases but "issues: done" would inflate this pass rate while its own
    // summary modal calls the same log Failed.
    const logPass = (l: {
      issueCount: number | null;
      doneCount?: number | null;
      remainingCount?: number | null;
      failedCount?: number | null;
      blockedCount?: number | null;
    }) => {
      const done = l.doneCount ?? 0;
      const remaining = l.remainingCount ?? 0;
      const tracked = done > 0 || remaining > 0;
      const issuesOpen = tracked ? remaining > 0 : (l.issueCount ?? 0) > 0;
      const hasCaseFailure = (l.failedCount ?? 0) > 0 || (l.blockedCount ?? 0) > 0;
      return !issuesOpen && !hasCaseFailure;
    };
    const manualCurrent = manualLogs.filter(l => logTs(l) >= thirtyDaysAgo);
    const manualPrev = manualLogs.filter(l => logTs(l) >= sixtyDaysAgo && logTs(l) < thirtyDaysAgo);

    // Pass rate for 30d window — CaseBased runs + quick logs, blended.
    const passed30d =
      runs30d.filter(r => r.result === 'Passed').length + manualCurrent.filter(logPass).length;
    const total30d = runs30d.length + manualCurrent.length;
    const passRate = total30d === 0 ? 0 : Math.round((passed30d / total30d) * 100);

    const passedPrev =
      runsPrev30d.filter(r => r.result === 'Passed').length + manualPrev.filter(logPass).length;
    const totalPrev = runsPrev30d.length + manualPrev.length;
    const passRatePrev = totalPrev === 0 ? 0 : Math.round((passedPrev / totalPrev) * 100);

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
    // Quick logs don't have a Blocked/Skipped concept — just their own Pass/Fail verdict.
    for (const l of manualLogs) {
      const t = logTs(l);
      const w = weeks.find(w => t >= w.start && t < w.end);
      if (!w) continue;
      if (logPass(l)) w.pass++;
      else w.fail++;
    }
    const weeklyRuns = weeks.map(w => ({
      label: w.label,
      pass: w.pass,
      fail: w.fail,
      blocked: w.blocked,
      skipped: w.skipped,
    }));

    // Module stability — pass rate per module across all (non-NotRun) runs,
    // plus quick logs scoped to that module or one of its suites (matches the
    // Stability report's attribution — logs scoped to All/Portal/Custom don't
    // point at a specific module, so they're not counted here).
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
        const suiteIds = new Set(m.suites.map(s => s.id));
        for (const s of m.suites) {
          for (const tc of s.testCases) walkCase(tc.runs);
        }
        for (const l of manualLogs) {
          const scoped =
            (l.scopeType === 'Module' && l.scopeId === m.id) ||
            (l.scopeType === 'Suite' && l.scopeId && suiteIds.has(l.scopeId));
          if (!scoped) continue;
          total++;
          if (logPass(l)) passed++;
        }
        const passRate = total === 0 ? null : Math.round((passed / total) * 100);
        return { name: m.name, passRate, totalRuns: total };
      })
      .filter(m => m.totalRuns > 0);

    // Recent cycles with per-cycle progress + scope name
    const recentCycles = recentCyclesRaw.map(c => {
      let counts = { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
      let total: number;
      let done: number;
      let passRate: number;
      if (c.mode === 'Manual') {
        // Quick logs have no per-case runs — represent the log itself as one
        // pass/fail data point so summaries that reduce over `counts` (the
        // Execution summary donut) count it instead of silently ignoring it.
        const isPass = logPass(c);
        counts = { ...counts, Passed: isPass ? 1 : 0, Failed: isPass ? 0 : 1 };
        total = 1;
        done = 1;
        passRate = isPass ? 100 : 0;
      } else {
        for (const r of c.runs) counts[r.result]++;
        total = c.runs.length;
        done = total - counts.NotRun;
        // Against `done`, not `total` — a cycle that's 6/14 executed with
        // all 6 passing should read 100%, not 43% diluted by the 8 cases
        // nobody has touched yet. Matches moduleStability's rule above,
        // which already excludes NotRun for the same reason.
        passRate = done === 0 ? 0 : Math.round((counts.Passed / done) * 100);
      }

      let scopeName: string | null = null;
      if (c.scopeType === 'All') scopeName = 'All test cases';
      else if (c.scopeType === 'Custom') scopeName = 'Custom selection';
      else if (c.scopeType === 'Portal' && c.scopeId)
        scopeName = recentPortalMap.get(c.scopeId) ?? null;
      else if (c.scopeType === 'Module' && c.scopeId)
        scopeName = recentModuleMap.get(c.scopeId) ?? null;
      else if (c.scopeType === 'Suite' && c.scopeId)
        scopeName = recentSuiteMap.get(c.scopeId) ?? null;

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        mode: c.mode,
        scopeType: c.scopeType,
        scopeName,
        createdAt: c.createdAt,
        completedAt: c.completedAt,
        total,
        done,
        passRate,
        counts,
        // Manual-cycle aggregates — used by the dashboard to render Pass/Fail
        // chips for quick-logs (where there are no real runs to %-derive from).
        moduleName: c.moduleName,
        featureName: c.featureName,
        portalName: c.portalName,
        issueCount: c.issueCount ?? 0,
      };
    });

    return ok({
      totalCases,
      runs30d: { total: total30d, prev: totalPrev },
      passRate: { current: passRate, prev: passRatePrev, delta: passRate - passRatePrev },
      openFailures: { total: openFailures, newToday: newFailuresToday },
      weeklyRuns,
      moduleStability,
      recentCycles,
    });
  } catch (e) {
    return serverError(e);
  }
}
