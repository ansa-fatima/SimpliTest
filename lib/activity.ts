// Shared "recent activity" merge -- used by the Dashboard's workspace-wide
// feed and the Teams screen's per-workspace feed, so both ever show exactly
// the same two REAL, directly-observable event kinds: a test run given a
// verdict, and a quick log being logged. Deliberately not attempting "cycle
// started"/"issue resolved"/"N cases created" -- nothing in the schema
// timestamps those moments, so synthesizing them would be showing fabricated
// activity. Extracted the moment a second real consumer needed the identical
// rule (see lib/recurringIssues.ts, lib/stability.ts for the same reasoning
// applied elsewhere).

export interface ActivityRunEvent {
  result: string;
  // Set only when the result is a workspace-custom option (see
  // lib/options.ts) -- its own name wins over the placeholder `result`
  // literal for display.
  customResult?: { name: string } | null;
  executedAt: Date | null;
  executedBy: string;
  testCase: { caseNum: number };
  cycle: { name: string };
}

export interface ActivityQuickLog {
  name: string;
  createdAt: Date;
  loggedBy: string;
  portalName: string | null;
  moduleName: string | null;
  featureName: string | null;
}

export type ActivityEvent =
  | {
      kind: 'run';
      actor: string;
      verb: string;
      caseLabel: string;
      result: string;
      cycleName: string;
      ts: string;
    }
  | { kind: 'quicklog'; actor: string; scopeName: string; ts: string };

export function buildRecentActivity(
  runEvents: ActivityRunEvent[],
  quickLogs: ActivityQuickLog[],
  limit = 8,
): ActivityEvent[] {
  const runItems: ActivityEvent[] = runEvents.map(r => ({
    kind: 'run',
    actor: r.executedBy || 'Someone',
    verb: 'marked',
    caseLabel: `TC-${String(r.testCase.caseNum).padStart(3, '0')}`,
    result: r.customResult?.name ?? r.result,
    cycleName: r.cycle.name,
    ts: r.executedAt!.toISOString(),
  }));
  const logItems: ActivityEvent[] = [...quickLogs]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(l => ({
      kind: 'quicklog',
      actor: l.loggedBy || 'Someone',
      scopeName: [l.portalName, l.moduleName, l.featureName].filter(Boolean).join(' › ') || l.name,
      ts: l.createdAt.toISOString(),
    }));
  return [...runItems, ...logItems]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, limit);
}
