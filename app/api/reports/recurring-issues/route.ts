import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { ok, serverError } from '@/lib/api';
import { parsePeriodParams } from '@/lib/period';
import { runResultClassWhereClause } from '@/lib/options';

export const dynamic = 'force-dynamic';

// GET /api/reports/recurring-issues
//   ?projectId=&portalId=&moduleId=&suiteId=&version=&tester=&period=&sprintOffset=
//
// Two independent signals:
//  - `cases`: test cases that have Failed/Blocked in 2+ distinct cycles, each
//    with the actual cycles it recurred in (same "2+ distinct cycles" rule as
//    lib/recurringIssues.ts, computed fresh here for a workspace-wide,
//    unlimited list instead of that helper's top-N). This is Recurring.
//  - `jiraReopened`: synced Jira sub-issues currently showing a Reopened
//    status. Jira-only, unrelated to the cases list above.

interface CaseCycle {
  id: string;
  name: string;
  // The resolved display name -- a built-in literal ("Failed"/"Blocked") or
  // a custom FailLike RunResult option's own name (see lib/options.ts).
  result: string;
  ts: string;
}
interface CaseRow {
  id: string;
  caseNum: number;
  title: string;
  severity: string;
  moduleName: string;
  scopePath: string;
  ownerName: string | null;
  cycles: CaseCycle[];
}

interface JiraIssueCycle {
  id: string;
  name: string;
  ts: string;
}
interface JiraIssueRow {
  issueKey: string;
  title: string;
  severity: string;
  status: string;
  siteUrl: string | null;
  cycles: JiraIssueCycle[];
  cycleCount: number;
  reopenedCount: number;
  lastSeen: string;
}

function caseModuleName(tc: {
  module?: { name: string } | null;
  suite?: { name: string; module: { name: string } } | null;
  portal?: { name: string } | null;
}): string {
  return tc.suite?.module.name ?? tc.module?.name ?? tc.portal?.name ?? 'Unscoped';
}
function caseScopePath(tc: {
  module?: { name: string } | null;
  suite?: { name: string; module: { name: string } } | null;
  portal?: { name: string } | null;
}): string {
  if (tc.suite) return `${tc.suite.module.name} → ${tc.suite.name}`;
  return caseModuleName(tc);
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const projectId = sp.get('projectId') || undefined;
    const portalIdFilter = sp.get('portalId') || undefined;
    const moduleIdFilter = sp.get('moduleId') || undefined;
    const suiteIdFilter = sp.get('suiteId') || undefined;
    const versionFilter = sp.get('version') || undefined;
    const testerFilter = sp.get('tester') || undefined;
    const { start: periodStart, end: periodEnd } = parsePeriodParams(sp);
    const failLikeFilter: Prisma.TestRunWhereInput = projectId
      ? await runResultClassWhereClause(projectId, ['FailLike'])
      : { result: { in: ['Failed', 'Blocked'] } };

    // A test case's own portal/module/suite fields decide whether it's in
    // scope — same OR-cascade /api/test-cases uses, so "under this module"
    // always means the same thing everywhere in the app.
    const caseScopeWhere = suiteIdFilter
      ? { suiteId: suiteIdFilter }
      : moduleIdFilter
        ? { OR: [{ moduleId: moduleIdFilter }, { suite: { moduleId: moduleIdFilter } }] }
        : portalIdFilter
          ? {
              OR: [
                { portalId: portalIdFilter },
                { module: { portalId: portalIdFilter } },
                { suite: { module: { portalId: portalIdFilter } } },
              ],
            }
          : {};

    const failedRuns = await prisma.testRun.findMany({
      where: {
        ...failLikeFilter,
        executedAt: {
          not: null,
          ...(periodStart ? { gte: periodStart } : {}),
          ...(periodEnd ? { lt: periodEnd } : {}),
        },
        cycle: {
          ...(projectId ? { projectId } : {}),
          ...(versionFilter ? { version: versionFilter } : {}),
        },
        ...(testerFilter ? { executedBy: testerFilter } : {}),
        testCase: caseScopeWhere,
      },
      orderBy: { executedAt: 'asc' },
      select: {
        testCaseId: true,
        result: true,
        customResult: { select: { name: true } },
        executedAt: true,
        cycle: { select: { id: true, name: true } },
        testCase: {
          select: {
            id: true,
            caseNum: true,
            title: true,
            severity: true,
            customSeverity: { select: { name: true } },
            owner: { select: { name: true, username: true } },
            module: { select: { name: true } },
            suite: { select: { name: true, module: { select: { name: true } } } },
            portal: { select: { name: true } },
          },
        },
      },
    });

    const byCase = new Map<
      string,
      {
        testCase: (typeof failedRuns)[number]['testCase'];
        cycles: Map<string, CaseCycle>;
      }
    >();
    for (const r of failedRuns) {
      const entry = byCase.get(r.testCaseId) ?? { testCase: r.testCase, cycles: new Map() };
      entry.cycles.set(r.cycle.id, {
        id: r.cycle.id,
        name: r.cycle.name,
        result: r.customResult?.name ?? r.result,
        ts: r.executedAt!.toISOString(),
      });
      byCase.set(r.testCaseId, entry);
    }

    const cases: CaseRow[] = Array.from(byCase.entries())
      .filter(([, v]) => v.cycles.size >= 2)
      .map(([id, v]) => {
        const tc = v.testCase;
        return {
          id: tc.id,
          caseNum: tc.caseNum,
          title: tc.title,
          severity: tc.customSeverity?.name ?? tc.severity,
          moduleName: caseModuleName(tc),
          scopePath: caseScopePath(tc),
          ownerName: tc.owner?.name || tc.owner?.username || null,
          cycles: Array.from(v.cycles.values()).sort(
            (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
          ),
        };
      })
      .sort((a, b) => b.cycles.length - a.cycles.length);

    // ── Jira-sourced signals ─────────────────────────────────────────────
    // Workspace-wide, from the JiraSubIssue snapshot table (one row per
    // cycle x sub-issue, replaced on every re-sync -- see JiraSyncPanel /
    // the cycles PATCH route). Not scoped by portal/module/version/tester:
    // a sub-issue only carries its parent cycle's id, and the user chose
    // "workspace-wide" for this detection rather than per-module scoping.
    const subIssueRows = projectId
      ? await prisma.jiraSubIssue.findMany({
          where: { projectId },
          orderBy: { syncedAt: 'desc' },
          select: {
            issueKey: true,
            title: true,
            severity: true,
            status: true,
            isReopened: true,
            syncedAt: true,
            cycleId: true,
            cycle: { select: { name: true, jiraSiteUrl: true } },
          },
        })
      : [];

    const byIssue = new Map<
      string,
      {
        issueKey: string;
        title: string;
        severity: string;
        status: string;
        siteUrl: string | null;
        cycles: Map<string, JiraIssueCycle>;
        reopenedCount: number;
        lastSeen: Date;
      }
    >();
    for (const s of subIssueRows) {
      const entry = byIssue.get(s.issueKey) ?? {
        issueKey: s.issueKey,
        title: s.title ?? s.issueKey,
        severity: s.severity,
        status: s.status,
        siteUrl: s.cycle.jiraSiteUrl,
        cycles: new Map<string, JiraIssueCycle>(),
        reopenedCount: 0,
        lastSeen: s.syncedAt,
      };
      // Rows arrive newest-first (orderBy syncedAt desc), so the first time
      // we see an issueKey it's already carrying the latest title/severity/
      // status/siteUrl -- only cycles/reopenedCount accumulate below.
      entry.cycles.set(s.cycleId, {
        id: s.cycleId,
        name: s.cycle.name,
        ts: s.syncedAt.toISOString(),
      });
      if (s.isReopened) entry.reopenedCount++;
      byIssue.set(s.issueKey, entry);
    }

    const allJiraIssues = Array.from(byIssue.values()).map(v => ({
      issueKey: v.issueKey,
      title: v.title,
      severity: v.severity,
      status: v.status,
      siteUrl: v.siteUrl,
      cycles: Array.from(v.cycles.values()).sort(
        (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
      ),
      cycleCount: v.cycles.size,
      reopenedCount: v.reopenedCount,
      lastSeen: v.lastSeen.toISOString(),
    }));

    // No minimum occurrence threshold -- a ticket reopened even once matters.
    // Recurring stays test-case-only (the `cases` list above); Jira issues
    // are only surfaced here for Reopened, not folded into Recurring too.
    const jiraReopened: JiraIssueRow[] = allJiraIssues
      .filter(v => v.reopenedCount >= 1)
      .sort((a, b) => b.reopenedCount - a.reopenedCount);

    return ok({ cases, jiraReopened });
  } catch (e) {
    return serverError(e);
  }
}
