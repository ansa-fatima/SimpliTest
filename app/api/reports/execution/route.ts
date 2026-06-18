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

    const runs = await prisma.testRun.findMany({
      where,
      select: { result: true, executedAt: true, executedBy: true },
    });

    const executed = runs.length;
    const passed = runs.filter(r => r.result === 'Passed').length;
    const failed = runs.filter(r => r.result === 'Failed').length;
    const blocked = runs.filter(r => r.result === 'Blocked').length;
    const skipped = runs.filter(r => r.result === 'Skipped').length;
    const passRate = executed === 0 ? 0 : Math.round((passed / executed) * 100);

    // Build daily buckets. Show up to 30 buckets; aggregate by week for >30-day windows.
    const bucketDays = days === null || days > 30 ? Math.ceil((days ?? 90) / 7) : (days ?? 30);
    const bucketSize = days === null ? 86_400_000 : days > 30 ? 7 * 86_400_000 : 86_400_000;
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
