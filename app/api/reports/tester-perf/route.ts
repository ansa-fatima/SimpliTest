import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { ok, serverError } from '@/lib/api';

// GET /api/reports/tester-perf
//   ?projectId=...
//   ?days=7|30|90|365|all   default 30
//
// Aggregated per-tester stats: executed / pass / fail / pass-rate / avg-per-day.
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const projectId = sp.get('projectId') || undefined;
    const daysParam = sp.get('days') || '30';
    const days =
      daysParam === 'all' ? null : Math.max(1, Math.min(365, parseInt(daysParam, 10) || 30));
    const from = days === null ? new Date(0) : new Date(Date.now() - days * 86_400_000);

    const where: Prisma.TestRunWhereInput = {
      executedAt: { gte: from, not: null },
      NOT: { result: 'NotRun', executedBy: '' },
    };
    if (projectId) where.cycle = { projectId };

    const runs = await prisma.testRun.findMany({
      where,
      select: { result: true, executedBy: true, executedAt: true },
    });

    interface Bucket {
      name: string;
      executed: number;
      passed: number;
      failed: number;
      blocked: number;
      skipped: number;
    }
    const byTester = new Map<string, Bucket>();
    for (const r of runs) {
      const key = r.executedBy?.trim();
      if (!key) continue;
      let b = byTester.get(key);
      if (!b) {
        b = { name: key, executed: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 };
        byTester.set(key, b);
      }
      b.executed++;
      if (r.result === 'Passed') b.passed++;
      else if (r.result === 'Failed') b.failed++;
      else if (r.result === 'Blocked') b.blocked++;
      else if (r.result === 'Skipped') b.skipped++;
    }

    const dayCount = days ?? Math.max(1, Math.ceil((Date.now() - from.getTime()) / 86_400_000));
    const testers = Array.from(byTester.values())
      .map(b => ({
        ...b,
        passRate: b.executed === 0 ? 0 : Math.round((b.passed / b.executed) * 100),
        avgPerDay: Math.round((b.executed / dayCount) * 10) / 10,
      }))
      .sort((a, b) => b.executed - a.executed);

    const totals = {
      testers: testers.length,
      executed: runs.length,
      avgPassRate:
        testers.length === 0
          ? 0
          : Math.round(testers.reduce((sum, t) => sum + t.passRate, 0) / testers.length),
    };

    return ok({ testers, totals, window: { days: days ?? 'all', dayCount } });
  } catch (e) {
    return serverError(e);
  }
}
