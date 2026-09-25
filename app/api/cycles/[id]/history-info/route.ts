import { prisma } from '@/lib/db';
import { ok, notFound, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

// GET /api/cycles/:id/history-info
//
// Everything the Cycle History report's read-only info modal needs, in one
// call -- deliberately its OWN route rather than more fields bolted onto
// GET /api/cycles/:id (used by every other "open this cycle" flow:
// CycleView, CycleOverview's edit-open, etc.), so this modal's extra
// queries (run breakdown, cross-cycle recurring check) never run for those
// screens.
//
// For a CaseBased cycle: `runSummary` (Passed/Failed/Blocked/NotRun counts
// + the most-frequent executor) and `recurringCases` (of THIS cycle's own
// Failed/Blocked cases, which ones also failed/blocked in some OTHER
// cycle). Both are null/empty for a Manual quick log, which has no
// per-case TestRun rows.
//
// `jiraSubIssues` carries title/severity/status/isReopened/timesReopened
// for either mode, but deliberately NO recurring signal -- Recurring is a
// test-case concept here (see `recurringCases`), not a Jira one.
// timesReopened is the one field on JiraSubIssue that survives a re-sync's
// delete+recreate (see the cycles PATCH route) -- a per-ticket count of
// how many times it's actually flipped into Reopened, not just "is it
// Reopened right now." `isReopened` rides along as a floor: a row synced
// before timesReopened existed (or whose only-ever Reopened sync predates
// it) sits at timesReopened=0 despite genuinely being reopened right now --
// the UI shows the badge whenever EITHER is true, using timesReopened once
// it's actually counted something.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const cycle = await prisma.testCycle.findUnique({ where: { id: params.id } });
    if (!cycle) return notFound('Cycle not found');

    let scopeName: string | null = null;
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
    } else if (cycle.scopeType === 'Suite' && cycle.scopeId) {
      const s = await prisma.suite.findUnique({
        where: { id: cycle.scopeId },
        select: { name: true, module: { select: { name: true } } },
      });
      scopeName = s ? `${s.module.name} / ${s.name}` : null;
    }

    const isManual = (cycle.mode ?? 'CaseBased') === 'Manual';

    let runSummary: {
      total: number;
      passed: number;
      failed: number;
      blocked: number;
      notRun: number;
      tester: string | null;
    } | null = null;
    const recurringCases: {
      id: string;
      caseNum: number;
      title: string;
      severity: string;
      cycleCount: number;
    }[] = [];

    if (!isManual) {
      const runs = await prisma.testRun.findMany({
        where: { cycleId: cycle.id },
        select: {
          result: true,
          executedBy: true,
          testCaseId: true,
          testCase: {
            select: {
              id: true,
              caseNum: true,
              title: true,
              severity: true,
              customSeverity: { select: { name: true } },
            },
          },
        },
      });

      const counts = { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
      const testerFreq = new Map<string, number>();
      for (const r of runs) {
        counts[r.result] = (counts[r.result] ?? 0) + 1;
        if (r.executedBy) testerFreq.set(r.executedBy, (testerFreq.get(r.executedBy) ?? 0) + 1);
      }
      let tester: string | null = null;
      let topCount = 0;
      for (const [name, count] of Array.from(testerFreq)) {
        if (count > topCount) {
          tester = name;
          topCount = count;
        }
      }
      runSummary = {
        total: runs.length,
        passed: counts.Passed,
        failed: counts.Failed,
        blocked: counts.Blocked,
        notRun: counts.NotRun + counts.Skipped,
        tester,
      };

      const myFailedRuns = runs.filter(r => r.result === 'Failed' || r.result === 'Blocked');
      if (myFailedRuns.length > 0) {
        const caseIds = Array.from(new Set(myFailedRuns.map(r => r.testCaseId)));
        const allFailedRuns = await prisma.testRun.findMany({
          where: { testCaseId: { in: caseIds }, result: { in: ['Failed', 'Blocked'] } },
          select: { testCaseId: true, cycleId: true },
        });
        const cyclesByCase = new Map<string, Set<string>>();
        for (const r of allFailedRuns) {
          const set = cyclesByCase.get(r.testCaseId) ?? new Set<string>();
          set.add(r.cycleId);
          cyclesByCase.set(r.testCaseId, set);
        }
        const seen = new Set<string>();
        for (const r of myFailedRuns) {
          if (seen.has(r.testCaseId)) continue;
          const cycleCount = cyclesByCase.get(r.testCaseId)?.size ?? 1;
          if (cycleCount < 2) continue;
          seen.add(r.testCaseId);
          recurringCases.push({
            id: r.testCase.id,
            caseNum: r.testCase.caseNum,
            title: r.testCase.title,
            severity: r.testCase.customSeverity?.name ?? r.testCase.severity,
            cycleCount,
          });
        }
      }
    }

    const jiraSubIssues = await prisma.jiraSubIssue.findMany({
      where: { cycleId: cycle.id },
      select: {
        issueKey: true,
        title: true,
        severity: true,
        status: true,
        isReopened: true,
        timesReopened: true,
      },
      orderBy: { issueKey: 'asc' },
    });

    return ok({
      id: cycle.id,
      name: cycle.name,
      description: cycle.description,
      mode: cycle.mode,
      status: cycle.status,
      portalName: cycle.portalName,
      moduleName: cycle.moduleName,
      featureName: cycle.featureName,
      scopeName,
      version: cycle.version,
      environment: cycle.environment,
      platform: cycle.platform,
      cycleCategory: cycle.cycleCategory,
      loggedBy: cycle.loggedBy,
      createdAt: cycle.createdAt,
      completedAt: cycle.completedAt,
      ticketLink: cycle.ticketLink,
      jiraStatus: cycle.jiraStatus,
      jiraSyncedAt: cycle.jiraSyncedAt,
      jiraSiteUrl: cycle.jiraSiteUrl,
      issueCount: cycle.issueCount,
      criticalCount: cycle.criticalCount,
      majorCount: cycle.majorCount,
      minorCount: cycle.minorCount,
      doneCount: cycle.doneCount,
      remainingCount: cycle.remainingCount,
      reopenedCount: cycle.reopenedCount,
      runSummary,
      recurringCases,
      jiraSubIssues,
    });
  } catch (e) {
    return serverError(e);
  }
}
