import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { ok, serverError } from '@/lib/api';

// GET /api/reports/execution
//   ?projectId=...  scope to a project
//   ?portalId=...   scope to a portal inside that project
//   ?cycleId=...    scope to a single test plan (cycle)
//   ?tester=...     scope to a single executor (executedBy string)
//   ?days=7|30|90|365|all   window size (default 30)
//
// Powers the "Execution" report shown in the design — KPI tiles + daily bar chart.
// Blends CaseBased TestRuns with Manual quick logs (their own issueCount === 0 →
// Pass verdict) — same convention as the Dashboard and Stability report — so a
// workspace that's mostly quick-logged doesn't show 0% here. Quick logs have no
// per-run tester, so they're left out entirely when a `tester` filter is active.
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const projectId = sp.get('projectId') || undefined;
    const portalId = sp.get('portalId') || undefined;
    const cycleId = sp.get('cycleId') || undefined;
    const tester = sp.get('tester') || undefined;
    const daysParam = sp.get('days') || '30';
    const days =
      daysParam === 'all' ? null : Math.max(1, Math.min(365, parseInt(daysParam, 10) || 30));

    const now = new Date();
    const from = days === null ? new Date(0) : new Date(now.getTime() - days * 86_400_000);

    // Build a TestRun filter that respects all selected dimensions.
    const where: Prisma.TestRunWhereInput = {
      executedAt: { gte: from, lte: now, not: null },
      NOT: { result: 'NotRun' },
    };
    if (cycleId) where.cycleId = cycleId;
    else if (portalId) {
      // Match runs of cases attached anywhere under the portal — direct, module, or suite.
      where.testCase = {
        OR: [{ portalId }, { module: { portalId } }, { suite: { module: { portalId } } }],
      };
      if (projectId) where.cycle = { projectId };
    } else if (projectId) {
      where.cycle = { projectId };
    }
    if (tester) where.executedBy = tester;

    // Modules/suites under the active portal — needed to attribute Module/Suite
    // -scoped quick logs to the same portal filter as the TestRun query above.
    let portalModuleIds: Set<string> | null = null;
    let portalSuiteIds: Set<string> | null = null;
    if (portalId && !cycleId) {
      const mods = await prisma.module.findMany({
        where: { portalId },
        select: { id: true, suites: { select: { id: true } } },
      });
      portalModuleIds = new Set(mods.map(m => m.id));
      portalSuiteIds = new Set(mods.flatMap(m => m.suites.map(s => s.id)));
    }

    const [runs, manualLogsRaw] = await Promise.all([
      prisma.testRun.findMany({
        where,
        select: { result: true, executedAt: true, executedBy: true },
      }),
      tester
        ? Promise.resolve([])
        : prisma.testCycle.findMany({
            where: {
              mode: 'Manual',
              ...(cycleId ? { id: cycleId } : projectId ? { projectId } : {}),
            },
            select: {
              completedAt: true,
              createdAt: true,
              issueCount: true,
              scopeType: true,
              scopeId: true,
            },
          }),
    ]);

    const manualLogs = manualLogsRaw.filter(l => {
      const t = l.completedAt ?? l.createdAt;
      if (t < from || t > now) return false;
      if (portalId && !cycleId) {
        if (l.scopeType === 'Portal') return l.scopeId === portalId;
        if (l.scopeType === 'Module') return !!l.scopeId && portalModuleIds!.has(l.scopeId);
        if (l.scopeType === 'Suite') return !!l.scopeId && portalSuiteIds!.has(l.scopeId);
        return false; // All/Custom-scoped logs don't point at this specific portal
      }
      return true;
    });
    const manualPass = (l: (typeof manualLogs)[number]) => (l.issueCount ?? 0) === 0;

    const executed = runs.length + manualLogs.length;
    const passed =
      runs.filter(r => r.result === 'Passed').length + manualLogs.filter(manualPass).length;
    const failed =
      runs.filter(r => r.result === 'Failed').length +
      manualLogs.filter(l => !manualPass(l)).length;
    const blocked = runs.filter(r => r.result === 'Blocked').length;
    const skipped = runs.filter(r => r.result === 'Skipped').length;
    const passRate = executed === 0 ? 0 : Math.round((passed / executed) * 100);

    // Build daily buckets for windows of 30 days or less; aggregate by week
    // for longer ones. "All time" used to default to a fixed 13-day daily
    // grid — far shorter than the actual data range the KPIs above already
    // cover, so the chart silently dropped everything older than 13 days
    // while the KPI tiles kept counting it. Size the "all time" grid to the
    // real span of the data instead (weekly buckets, capped so a very old
    // workspace doesn't render hundreds of bars).
    let bucketDays: number;
    let bucketSize: number;
    if (days === null) {
      const allTimestamps = [
        ...runs.map(r => r.executedAt!.getTime()),
        ...manualLogs.map(l => (l.completedAt ?? l.createdAt).getTime()),
      ];
      const earliest = allTimestamps.length ? Math.min(...allTimestamps) : now.getTime();
      const spanDays = Math.max(1, Math.ceil((now.getTime() - earliest) / 86_400_000));
      bucketSize = 7 * 86_400_000;
      bucketDays = Math.min(60, Math.max(1, Math.ceil(spanDays / 7)));
    } else if (days > 30) {
      bucketSize = 7 * 86_400_000;
      bucketDays = Math.ceil(days / 7);
    } else {
      bucketSize = 86_400_000;
      bucketDays = days;
    }
    const buckets: {
      label: string;
      from: Date;
      to: Date;
      pass: number;
      fail: number;
      blocked: number;
      skipped: number;
      total: number;
    }[] = [];

    // Anchor the bucket grid to `now` so the last bucket ends today.
    for (let i = bucketDays - 1; i >= 0; i--) {
      const to = new Date(now.getTime() - i * bucketSize);
      const fromBucket = new Date(to.getTime() - bucketSize);
      buckets.push({
        label: fmtBucketLabel(fromBucket, bucketSize),
        from: fromBucket,
        to,
        pass: 0,
        fail: 0,
        blocked: 0,
        skipped: 0,
        total: 0,
      });
    }
    for (const r of runs) {
      const t = r.executedAt!;
      const b = buckets.find(b => t >= b.from && t < b.to);
      if (!b) continue;
      b.total++;
      if (r.result === 'Passed') b.pass++;
      else if (r.result === 'Failed') b.fail++;
      else if (r.result === 'Blocked') b.blocked++;
      else if (r.result === 'Skipped') b.skipped++;
    }
    // Quick logs don't have a Blocked/Skipped concept — just their own verdict.
    for (const l of manualLogs) {
      const t = l.completedAt ?? l.createdAt;
      const b = buckets.find(b => t >= b.from && t < b.to);
      if (!b) continue;
      b.total++;
      if (manualPass(l)) b.pass++;
      else b.fail++;
    }
    const daily = buckets.map(b => ({
      label: b.label,
      pass: b.pass,
      fail: b.fail,
      blocked: b.blocked,
      skipped: b.skipped,
      total: b.total,
    }));

    // Provide filter options scoped to the active project so the dropdowns are populated.
    const [cycles, distinctTestersRaw] = await Promise.all([
      prisma.testCycle.findMany({
        where: projectId ? { projectId } : undefined,
        select: { id: true, name: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.testRun.findMany({
        where: {
          ...(projectId ? { cycle: { projectId } } : {}),
          executedAt: { not: null },
          NOT: { executedBy: '' },
        },
        distinct: ['executedBy'],
        select: { executedBy: true },
        take: 50,
      }),
    ]);
    const availableTesters = distinctTestersRaw
      .map(r => r.executedBy)
      .filter(Boolean)
      .sort();

    return ok({
      window: { days: days ?? 'all', from, to: now },
      kpis: { executed, passed, failed, blocked, skipped, passRate },
      daily,
      filters: { cycles, testers: availableTesters },
    });
  } catch (e) {
    return serverError(e);
  }
}

function fmtBucketLabel(start: Date, bucketSize: number): string {
  // Daily buckets show "DD MMM"; weekly buckets show "DD MMM" of the start of the week.
  return start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
