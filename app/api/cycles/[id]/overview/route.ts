import { prisma } from '@/lib/db';
import { ok, notFound, serverError } from '@/lib/api';
import { computeRecurringIssues, caseScopeName } from '@/lib/recurringIssues';
import { pointFromRun, pointFromQuickLog, stats } from '@/lib/stability';
import {
  loadRunResultClassMap,
  runResultClassWhereClause,
  countsForStability,
} from '@/lib/options';

interface Ctx {
  params: { id: string };
}

// Same run shape pointFromRun() needs -- shared select so this matches
// exactly what the Dashboard/Stability report ask Prisma for.
const runSelect = {
  result: true,
  customResultId: true,
  executedAt: true,
  updatedAt: true,
  cycleId: true,
  cycle: { select: { name: true } },
} as const;

// GET /api/cycles/:id/overview
// The "before you dive into the run" summary a cycle opens to: headline
// KPIs, who mostly ran it, and any test cases that failed here AND have
// failed/blocked in an earlier cycle too -- real recurring-issue history,
// not a fabricated "related items" widget.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const cycle = await prisma.testCycle.findUnique({
      where: { id: params.id },
      include: {
        runs: { select: { result: true, executedBy: true } },
      },
    });
    if (!cycle) return notFound('Cycle not found');

    const counts = { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
    const executorCounts = new Map<string, number>();
    for (const r of cycle.runs) {
      counts[r.result]++;
      if (r.executedBy)
        executorCounts.set(r.executedBy, (executorCounts.get(r.executedBy) ?? 0) + 1);
    }
    let tester: string | null = null;
    let topCount = 0;
    executorCounts.forEach((n, name) => {
      if (n > topCount) {
        tester = name;
        topCount = n;
      }
    });

    const total = cycle.runs.length;
    const executed = total - counts.NotRun;
    const percent = total === 0 ? 0 : Math.round((executed / total) * 100);
    const passRate = executed === 0 ? 0 : Math.round((counts.Passed / executed) * 100);

    // Resolve scope + module name (case-based cycles only carry a
    // scopeType/scopeId; Manual quick logs already have free-text names).
    // moduleId is also captured here (when resolvable) to drive the
    // Stability panel below -- a real DB id, not just its display name.
    let scopeName: string | null = null;
    let moduleName: string | null = cycle.moduleName;
    let moduleId: string | null = null;
    if (cycle.scopeType === 'All') scopeName = 'All test cases';
    else if (cycle.scopeType === 'Custom') scopeName = 'Custom selection';
    else if (cycle.scopeType === 'Portal' && cycle.scopeId) {
      const p = await prisma.portal.findUnique({
        where: { id: cycle.scopeId },
        select: { name: true },
      });
      scopeName = p?.name ?? null;
    } else if (cycle.scopeType === 'Module' && cycle.scopeId) {
      const m = await prisma.module.findUnique({
        where: { id: cycle.scopeId },
        select: { name: true },
      });
      scopeName = m?.name ?? null;
      moduleName = moduleName ?? scopeName;
      moduleId = cycle.scopeId;
    } else if (cycle.scopeType === 'Suite' && cycle.scopeId) {
      const s = await prisma.suite.findUnique({
        where: { id: cycle.scopeId },
        select: { name: true, module: { select: { id: true, name: true } } },
      });
      scopeName = s ? `${s.module.name} / ${s.name}` : null;
      moduleName = moduleName ?? s?.module.name ?? null;
      moduleId = s?.module.id ?? null;
    }

    // Stability: this cycle's own module, scored the exact same way the
    // Dashboard's Coverage-by-module panel and the Stability report already
    // do (shared lib/stability helpers) -- so it reads as "how has this
    // area been doing overall", not just "how did this one cycle go".
    // Only resolvable when the cycle targets a single module or a suite
    // under one; a Portal/All/Custom-scoped cycle has no single module to
    // score, so this stays null rather than picking one arbitrarily.
    let stability: {
      moduleName: string;
      passRate: number;
      label: string;
      trend: string;
      total: number;
    } | null = null;
    if (moduleId) {
      const mod = await prisma.module.findUnique({
        where: { id: moduleId },
        select: {
          name: true,
          testCases: { select: { id: true, title: true, runs: { select: runSelect } } },
          suites: {
            select: {
              id: true,
              testCases: { select: { id: true, title: true, runs: { select: runSelect } } },
            },
          },
        },
      });
      if (mod) {
        const resultClassMap = await loadRunResultClassMap(cycle.projectId);
        const points = [
          ...mod.testCases.flatMap(tc =>
            tc.runs
              .filter(r => countsForStability(r, resultClassMap))
              .map(r => pointFromRun({ ...r, testCase: { title: tc.title } }, resultClassMap)),
          ),
          ...mod.suites.flatMap(s =>
            s.testCases.flatMap(tc =>
              tc.runs
                .filter(r => countsForStability(r, resultClassMap))
                .map(r => pointFromRun({ ...r, testCase: { title: tc.title } }, resultClassMap)),
            ),
          ),
        ];
        const suiteIds = mod.suites.map(s => s.id);
        const manualLogs = await prisma.testCycle.findMany({
          where: {
            mode: 'Manual',
            OR: [
              { scopeType: 'Module', scopeId: moduleId },
              ...(suiteIds.length
                ? [{ scopeType: 'Suite' as const, scopeId: { in: suiteIds } }]
                : []),
            ],
          },
          select: {
            id: true,
            name: true,
            issueCount: true,
            doneCount: true,
            remainingCount: true,
            failedCount: true,
            blockedCount: true,
            completedAt: true,
            createdAt: true,
          },
        });
        for (const l of manualLogs) points.push(pointFromQuickLog(l));

        const s = stats(points);
        stability = {
          moduleName: mod.name,
          passRate: s.passRate,
          label: s.label,
          trend: s.trend,
          total: s.total,
        };
      }
    }

    // Recurring issues: cases that failed/blocked HERE and also
    // failed/blocked in at least one other cycle -- same "2+ distinct
    // cycles" rule the Dashboard's workspace-wide panel uses (see
    // lib/recurringIssues), just scoped down to this cycle's own failures.
    const failLikeFilter = await runResultClassWhereClause(cycle.projectId, ['FailLike']);
    const failedHereRuns = await prisma.testRun.findMany({
      where: { cycleId: cycle.id, ...failLikeFilter },
      select: { testCaseId: true },
    });
    const failedCaseIds = Array.from(new Set(failedHereRuns.map(r => r.testCaseId)));

    const priorRuns = failedCaseIds.length
      ? await prisma.testRun.findMany({
          where: {
            testCaseId: { in: failedCaseIds },
            ...failLikeFilter,
            executedAt: { not: null },
          },
          select: {
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
        })
      : [];

    const recurringIssues = computeRecurringIssues(
      priorRuns.map(r => ({
        cycleId: r.cycleId,
        executedAt: r.executedAt!,
        testCase: {
          id: r.testCase.id,
          title: r.testCase.title,
          caseNum: r.testCase.caseNum,
          severity: r.testCase.severity,
          scopeName: caseScopeName(r.testCase),
        },
      })),
      8,
    );

    return ok({
      cycle: {
        id: cycle.id,
        name: cycle.name,
        status: cycle.status,
        cycleCategory: cycle.cycleCategory,
        version: cycle.version,
        ticketLink: cycle.ticketLink,
        jiraSiteUrl: cycle.jiraSiteUrl,
        environment: cycle.environment,
        platform: cycle.platform,
        scopeName,
        moduleName,
        createdAt: cycle.createdAt,
        completedAt: cycle.completedAt,
        targetDate: cycle.targetDate,
      },
      total,
      executed,
      percent,
      passRate,
      failed: counts.Failed,
      blocked: counts.Blocked,
      counts,
      tester,
      stability,
      recurringIssues,
    });
  } catch (e) {
    return serverError(e);
  }
}
