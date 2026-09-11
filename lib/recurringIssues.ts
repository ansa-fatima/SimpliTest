// Shared "keeps coming back" grouping -- used by the Dashboard's workspace-
// wide Recurring Issues panel and the Cycle Overview's per-cycle one, so
// "recurring" means exactly the same thing (Failed/Blocked in 2+ distinct
// cycles) everywhere it's shown. Extracted the moment a second real
// consumer needed the identical rule (see lib/stability.ts, lib/period.ts
// for the same reasoning applied elsewhere).

export interface RecurringIssueRun {
  cycleId: string;
  executedAt: Date;
  testCase: {
    id: string;
    title: string;
    caseNum: number;
    severity: string;
    scopeName: string;
  };
}

export interface RecurringIssueRow {
  id: string;
  title: string;
  caseNum: number;
  severity: string;
  scopeName: string;
  occurrences: number;
  cycleCount: number;
  lastSeen: string;
}

// `runs` should already be filtered to Failed/Blocked, executedAt-not-null
// rows -- this only does the grouping, not the result/date filtering, since
// callers scope the source query differently (workspace-wide vs one cycle).
export function computeRecurringIssues(
  runs: RecurringIssueRun[],
  limit = 5,
): { total: number; items: RecurringIssueRow[] } {
  const byCase = new Map<
    string,
    {
      id: string;
      title: string;
      caseNum: number;
      severity: string;
      scopeName: string;
      cycles: Set<string>;
      occurrences: number;
      lastSeen: Date;
    }
  >();
  for (const r of runs) {
    const tc = r.testCase;
    const existing = byCase.get(tc.id);
    if (existing) {
      existing.cycles.add(r.cycleId);
      existing.occurrences++;
      if (r.executedAt > existing.lastSeen) existing.lastSeen = r.executedAt;
    } else {
      byCase.set(tc.id, {
        id: tc.id,
        title: tc.title,
        caseNum: tc.caseNum,
        severity: tc.severity,
        scopeName: tc.scopeName,
        cycles: new Set([r.cycleId]),
        occurrences: 1,
        lastSeen: r.executedAt,
      });
    }
  }
  const list = Array.from(byCase.values())
    .filter(c => c.cycles.size >= 2)
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());

  return {
    total: list.length,
    items: list.slice(0, limit).map(c => ({
      id: c.id,
      title: c.title,
      caseNum: c.caseNum,
      severity: c.severity,
      scopeName: c.scopeName,
      occurrences: c.occurrences,
      cycleCount: c.cycles.size,
      lastSeen: c.lastSeen.toISOString(),
    })),
  };
}

// A case attaches to a portal, module, OR suite directly -- resolve
// whichever one holds it into a single display label.
export function caseScopeName(tc: {
  module?: { name: string } | null;
  suite?: { name: string; module: { name: string } } | null;
  portal?: { name: string } | null;
}): string {
  if (tc.suite) return `${tc.suite.module.name} › ${tc.suite.name}`;
  return tc.module?.name ?? tc.portal?.name ?? 'Unscoped';
}
