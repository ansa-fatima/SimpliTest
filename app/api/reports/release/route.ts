import { prisma } from '@/lib/db';
import { Prisma, CycleStatus } from '@prisma/client';
import { ok, serverError } from '@/lib/api';

// GET /api/reports/release
//   ?projectId=...
//   ?status=Active|Completed|Archived
//   ?days=30|90|365|all   default 90  (filters by createdAt)
//
// Per-cycle ("release") rollup — pass / fail / blocked counts + completion %.
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const projectId = sp.get('projectId') || undefined;
    const status = sp.get('status') as CycleStatus | null;
    const daysParam = sp.get('days') || '90';
    const days =
      daysParam === 'all' ? null : Math.max(1, Math.min(365, parseInt(daysParam, 10) || 90));

    const where: Prisma.TestCycleWhereInput = {};
    if (projectId) where.projectId = projectId;
    if (status && ['Active', 'Completed', 'Archived'].includes(status)) where.status = status;
    if (days !== null) where.createdAt = { gte: new Date(Date.now() - days * 86_400_000) };

    const cycles = await prisma.testCycle.findMany({
      where,
      include: { runs: { select: { result: true, executedBy: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const releases = cycles.map(c => {
      const counts = { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
      const testers = new Set<string>();
      for (const r of c.runs) {
        counts[r.result]++;
        if (r.executedBy) testers.add(r.executedBy);
      }
      const total = c.runs.length;
      const done = total - counts.NotRun;
      const passRate = done === 0 ? 0 : Math.round((counts.Passed / done) * 100);
      const percent = total === 0 ? 0 : Math.round((done / total) * 100);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        scopeType: c.scopeType,
        createdAt: c.createdAt,
        targetDate: c.targetDate,
        total,
        done,
        passRate,
        percent,
        counts,
        testers: Array.from(testers).slice(0, 6),
      };
    });

    // Aggregate header
    const totals = releases.reduce(
      (acc, r) => {
        acc.total += r.total;
        acc.passed += r.counts.Passed;
        acc.failed += r.counts.Failed;
        acc.blocked += r.counts.Blocked;
        acc.done += r.done;
        return acc;
      },
      { total: 0, passed: 0, failed: 0, blocked: 0, done: 0 },
    );
    const overallPassRate = totals.done === 0 ? 0 : Math.round((totals.passed / totals.done) * 100);

    return ok({
      releases,
      totals: { ...totals, overallPassRate, cycles: releases.length },
    });
  } catch (e) {
    return serverError(e);
  }
}
