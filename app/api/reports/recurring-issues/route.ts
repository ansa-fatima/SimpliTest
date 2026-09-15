import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';
import { parsePeriodParams } from '@/lib/period';

export const dynamic = 'force-dynamic';

// GET /api/reports/recurring-issues
//   ?projectId=&portalId=&moduleId=&suiteId=&version=&tester=&period=&sprintOffset=
//
// Test cases that have Failed/Blocked in 2+ distinct cycles, each with the
// actual cycles it recurred in (same "2+ distinct cycles" rule as
// lib/recurringIssues.ts, computed fresh here for a workspace-wide,
// unlimited list instead of that helper's top-N).

interface CaseCycle {
  id: string;
  name: string;
  result: 'Failed' | 'Blocked';
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
        result: { in: ['Failed', 'Blocked'] },
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
        executedAt: true,
        cycle: { select: { id: true, name: true } },
        testCase: {
          select: {
            id: true,
            caseNum: true,
            title: true,
            severity: true,
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
        result: r.result as 'Failed' | 'Blocked',
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
          severity: tc.severity,
          moduleName: caseModuleName(tc),
          scopePath: caseScopePath(tc),
          ownerName: tc.owner?.name || tc.owner?.username || null,
          cycles: Array.from(v.cycles.values()).sort(
            (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
          ),
        };
      })
      .sort((a, b) => b.cycles.length - a.cycles.length);

    return ok({ cases });
  } catch (e) {
    return serverError(e);
  }
}
