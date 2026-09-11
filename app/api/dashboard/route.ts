import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';
import { pointFromRun, pointFromQuickLog, stats } from '@/lib/stability';
import { computeRecurringIssues, caseScopeName } from '@/lib/recurringIssues';

// Full run detail needed by pointFromRun() -- shared so the module-stability
// query below and the Stability report ask Prisma for exactly the same shape.
const runSelect = {
  result: true,
  executedAt: true,
  updatedAt: true,
  cycleId: true,
  cycle: { select: { name: true } },
} as const;

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
      criticalIssues,
      modules,
      allRuns,
      manualLogs,
      recentCyclesRaw,
      recurringRuns,
      recentRunEvents,
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
      // Same "open failure" methodology as openFailures above, narrowed to
      // Critical severity -- a KPI for "how many of the currently-open
      // failures are the ones that actually matter most".
      prisma.testRun.count({
        where: {
          result: 'Failed',
          cycle: { status: 'Active', ...wsCycle },
          testCase: { severity: 'Critical' },
        },
      }),
      prisma.module.findMany({
        where: projectId ? { portal: { projectId } } : undefined,
        select: {
          id: true,
          name: true,
          // Direct module-attached cases -- full run detail (not just
          // result) so these can feed the same stats()/pointFromRun scoring
          // the Stability report uses, instead of a separate simpler rule.
          testCases: { select: { id: true, title: true, runs: { select: runSelect } } },
          // Plus cases nested in suites below this module
          suites: {
            select: {
              id: true,
              testCases: {
                select: { id: true, title: true, runs: { select: runSelect } },
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
          id: true,
          name: true,
          completedAt: true,
          createdAt: true,
          issueCount: true,
          doneCount: true,
          remainingCount: true,
          failedCount: true,
          blockedCount: true,
          scopeType: true,
          scopeId: true,
          loggedBy: true,
          portalName: true,
          moduleName: true,
          featureName: true,
        },
      }),
      prisma.testCycle.findMany({
        where: { status: { not: 'Archived' }, ...wsCycle },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          runs: { select: { result: true, wasEverIssue: true, executedBy: true } },
        },
      }),
      // Recurring issues -- a test case that has failed/blocked in more than
      // one distinct cycle. Fetched unwindowed (all history) since "keeps
      // coming back" is inherently a long-view question; grouped in JS below
      // because Prisma can't easily express "count of distinct cycleId per
      // testCaseId" in one groupBy.
      prisma.testRun.findMany({
        where: { result: { in: ['Failed', 'Blocked'] }, executedAt: { not: null }, cycle: wsCycle },
        select: {
          testCaseId: true,
          cycleId: true,
          executedAt: true,
          testCase: {
            select: {
              id: true,
              title: true,
              caseNum: true,
              severity: true,
              module: { select: { name: true } },
              suite: { select: { name: true, module: { select: { name: true } } } },
              portal: { select: { name: true } },
            },
          },
        },
      }),
      // Recent individual test-run verdicts -- one of the two real event
      // types behind Recent Activity (the other is quick-log creation, read
      // from manualLogs above). Deliberately NOT trying to synthesize
      // "cycle started"/"issue resolved" events -- nothing tracks those
      // moments today, so inventing them would be showing fake activity.
      prisma.testRun.findMany({
        where: { executedAt: { not: null }, NOT: { result: 'NotRun' }, cycle: wsCycle },
        orderBy: { executedAt: 'desc' },
        take: 8,
        select: {
          result: true,
          executedAt: true,
          executedBy: true,
          testCase: { select: { title: true, caseNum: true } },
          cycle: { select: { name: true } },
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

    // Failed/Blocked 30d counts, same blended convention as passed30d above.
    // Quick logs have no Blocked concept -- a failed log is just a Failed
    // count, never a Blocked one.
    const failed30d =
      runs30d.filter(r => r.result === 'Failed').length +
      manualCurrent.filter(l => !logPass(l)).length;
    const blocked30d = runs30d.filter(r => r.result === 'Blocked').length;
    const failedPrev30d =
      runsPrev30d.filter(r => r.result === 'Failed').length +
      manualPrev.filter(l => !logPass(l)).length;
    const blockedPrev30d = runsPrev30d.filter(r => r.result === 'Blocked').length;
    const pctChange = (curr: number, prev: number) =>
      prev === 0 ? (curr === 0 ? 0 : 100) : Math.round(((curr - prev) / prev) * 100);

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

    // Module stability — same scoring as the Stability report (partial
    // credit, Stable/At Risk/Unstable thresholds, trend), via the shared
    // lib/stability helpers, so this panel's numbers can never disagree with
    // the dedicated report. Quick logs scoped to a module or one of its
    // suites count too (logs scoped to All/Portal/Custom don't point at a
    // specific module, so they're not counted here).

    // Recurring issues -- a test case that's failed/blocked in 2+ DISTINCT
    // cycles (a case that fails once and gets fixed isn't "recurring" --
    // one that keeps coming back across separate runs is). Shared grouping
    // with the Cycle Overview's per-cycle version — see lib/recurringIssues.
    const recurringIssues = computeRecurringIssues(
      recurringRuns.map(r => ({
        cycleId: r.cycleId,
        executedAt: r.executedAt!,
        testCase: { ...r.testCase, scopeName: caseScopeName(r.testCase) },
      })),
      5,
    );

    // Recent activity -- two real, directly-observable event kinds. Not
    // attempting "cycle started"/"issue resolved"/"N cases created" here:
    // nothing in the schema timestamps those moments, so synthesizing them
    // would just be showing fabricated activity.
    const runEvents = recentRunEvents.map(r => ({
      kind: 'run' as const,
      actor: r.executedBy || 'Someone',
      verb: r.result === 'Passed' ? 'marked' : 'marked',
      caseLabel: `TC-${String(r.testCase.caseNum).padStart(3, '0')}`,
      result: r.result,
      cycleName: r.cycle.name,
      ts: r.executedAt!.toISOString(),
    }));
    const logEvents = [...manualLogs]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 8)
      .map(l => ({
        kind: 'quicklog' as const,
        actor: l.loggedBy || 'Someone',
        scopeName:
          [l.portalName, l.moduleName, l.featureName].filter(Boolean).join(' › ') || l.name,
        ts: l.createdAt.toISOString(),
      }));
    const recentActivity = [...runEvents, ...logEvents]
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 8);

    const moduleStability = modules
      .map(m => {
        const points = [
          ...m.testCases.flatMap(tc =>
            tc.runs
              .filter(r => r.result === 'Passed' || r.result === 'Failed')
              .map(r => pointFromRun({ ...r, testCase: { title: tc.title } })),
          ),
          ...m.suites.flatMap(s =>
            s.testCases.flatMap(tc =>
              tc.runs
                .filter(r => r.result === 'Passed' || r.result === 'Failed')
                .map(r => pointFromRun({ ...r, testCase: { title: tc.title } })),
            ),
          ),
        ];
        const suiteIds = new Set(m.suites.map(s => s.id));
        for (const l of manualLogs) {
          const scoped =
            (l.scopeType === 'Module' && l.scopeId === m.id) ||
            (l.scopeType === 'Suite' && l.scopeId && suiteIds.has(l.scopeId));
          if (!scoped) continue;
          points.push(pointFromQuickLog(l));
        }
        const s = stats(points);
        // "Issues" = the data points that didn't pass -- the same failing
        // runs/logs that pull the pass rate down, not a separately-tracked
        // count that could disagree with it.
        return {
          name: m.name,
          passRate: s.total === 0 ? null : s.passRate,
          totalRuns: s.total,
          issues: s.failed,
          label: s.label,
          trend: s.trend,
        };
      })
      .filter(m => m.totalRuns > 0);

    // Recent cycles with per-cycle progress + scope name
    const recentCycles = recentCyclesRaw.map(c => {
      let counts = { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
      let total: number;
      let done: number;
      let passRate: number;
      // Stable baseline (every case ever Failed/Blocked, per the sticky
      // wasEverIssue flag) — same "Issues" figure shown in the Test runs
      // list and cycle detail, so this row's issue count doesn't disagree
      // with the one you'd see after clicking into the run.
      let issuesFound = 0;
      if (c.mode === 'Manual') {
        // Quick logs have no per-case runs — represent the log itself as one
        // pass/fail data point so summaries that reduce over `counts` (the
        // Execution summary donut) count it instead of silently ignoring it.
        const isPass = logPass(c);
        counts = { ...counts, Passed: isPass ? 1 : 0, Failed: isPass ? 0 : 1 };
        total = 1;
        done = 1;
        passRate = isPass ? 100 : 0;
        issuesFound = c.issueCount ?? 0;
      } else {
        for (const r of c.runs) {
          counts[r.result]++;
          if (r.wasEverIssue) issuesFound++;
        }
        total = c.runs.length;
        done = total - counts.NotRun;
        // Against `done`, not `total` — a cycle that's 6/14 executed with
        // all 6 passing should read 100%, not 43% diluted by the 8 cases
        // nobody has touched yet. Matches moduleStability's rule above,
        // which already excludes NotRun for the same reason.
        passRate = done === 0 ? 0 : Math.round((counts.Passed / done) * 100);
      }

      // Same "single name or 'N testers'" convention as the Cycle History
      // report -- executedBy for a case-based run, loggedBy for a quick log.
      const tester =
        c.mode === 'Manual'
          ? c.loggedBy || ''
          : (() => {
              const names = Array.from(new Set(c.runs.map(r => r.executedBy).filter(Boolean)));
              return names.length === 0
                ? ''
                : names.length === 1
                  ? names[0]
                  : `${names.length} testers`;
            })();

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
        tester,
        // Manual-cycle aggregates — used by the dashboard to render Pass/Fail
        // chips for quick-logs (where there are no real runs to %-derive from).
        moduleName: c.moduleName,
        featureName: c.featureName,
        portalName: c.portalName,
        issueCount: issuesFound,
      };
    });

    return ok({
      totalCases,
      runs30d: { total: total30d, prev: totalPrev },
      passRate: { current: passRate, prev: passRatePrev, delta: passRate - passRatePrev },
      openFailures: { total: openFailures, newToday: newFailuresToday },
      criticalIssues,
      passed30d: { total: passed30d, pctChange: pctChange(passed30d, passedPrev) },
      failed30d: { total: failed30d, pctChange: pctChange(failed30d, failedPrev30d) },
      blocked30d: { total: blocked30d, pctChange: pctChange(blocked30d, blockedPrev30d) },
      weeklyRuns,
      moduleStability,
      recurringIssues,
      recentActivity,
      recentCycles,
    });
  } catch (e) {
    return serverError(e);
  }
}
