// Shared "how stable is this?" scoring — used by both the Stability report
// and the Dashboard's Coverage-by-module panel, so a module's pass rate,
// Stable/At Risk/Unstable label, and trend arrow can never disagree between
// the two places that show them. Extracted here the moment a second real
// consumer needed the exact same rule (see lib/period.ts for the same
// reasoning applied to period/sprint math).
import { RunResultClass } from '@prisma/client';
import { resultClassOf } from '@/lib/options';

export type DataPoint = {
  pass: boolean;
  // 0-1 credit this point contributes to the pass rate. Binary (0 or 1) for
  // a test case run, but a tracked quick log gets partial credit for partial
  // resolution -- 6 of 8 issues done reads as 75%, not a flat 0% just
  // because it isn't fully resolved yet.
  score: number;
  ts: Date;
  cycleId: string;
  cycleName: string;
  kind: 'quicklog' | 'caserun';
  label: string;
  detail: string;
};

// `resultClassMap` resolves a custom RunResult override's countsAs (see
// lib/options.ts) -- omit it when every run passed in is known to carry the
// legacy enum value only (no customResultId), since the classification then
// needs no lookup at all.
export function pointFromRun(
  r: {
    result: string;
    customResultId?: string | null;
    executedAt: Date | null;
    updatedAt: Date;
    cycleId: string;
    cycle: { name: string };
    testCase: { title: string };
  },
  resultClassMap?: Map<string, RunResultClass>,
): DataPoint {
  const resultClass = resultClassOf(
    { result: r.result, customResultId: r.customResultId ?? null },
    resultClassMap ?? new Map(),
  );
  const pass = resultClass === 'PassLike';
  return {
    pass,
    score: pass ? 1 : 0,
    ts: r.executedAt ?? r.updatedAt,
    cycleId: r.cycleId,
    cycleName: r.cycle.name,
    kind: 'caserun',
    label: r.testCase.title,
    detail: `${r.result} · ${r.cycle.name}`,
  };
}

export function pointFromQuickLog(log: {
  id: string;
  name: string;
  issueCount: number | null;
  doneCount: number | null;
  remainingCount: number | null;
  failedCount: number | null;
  blockedCount: number | null;
  completedAt: Date | null;
  createdAt: Date;
}): DataPoint {
  // Done/Remaining are only meaningful once someone has actually filled them
  // in (e.g. re-opening this cycle after a retest) -- untouched, both
  // default to 0, which must NOT read as "nothing remains". Once they ARE
  // tracked, they're the live truth: a cycle that originally found 8 issues
  // but was edited to 0 remaining is a genuine pass now, even though
  // issueCount (what was found) still says 8. Untracked cycles keep the
  // original "found nothing" rule.
  const done = log.doneCount ?? 0;
  const remaining = log.remainingCount ?? 0;
  const tracked = done > 0 || remaining > 0;
  const issuesOpen = tracked ? remaining > 0 : (log.issueCount ?? 0) > 0;
  // A log can separately record real Failed/Blocked test-case results even
  // once its own issue tracking says fully resolved -- those still count as
  // a fail here, same rule the Quick Log Summary modal already uses.
  const hasCaseFailure = (log.failedCount ?? 0) > 0 || (log.blockedCount ?? 0) > 0;
  const pass = !issuesOpen && !hasCaseFailure;
  // A tracked log (and no case failure) gets partial credit for partial
  // resolution (6 of 8 done = 0.75) instead of an all-or-nothing 0/1.
  const score = tracked && !hasCaseFailure ? done / (done + remaining) : pass ? 1 : 0;
  let detail: string;
  if (pass) {
    detail = tracked ? `Pass · ${done} issue${done === 1 ? '' : 's'} resolved` : 'Pass';
  } else if (hasCaseFailure) {
    detail = `Fail · ${log.failedCount ?? 0} failed, ${log.blockedCount ?? 0} blocked`;
  } else if (tracked) {
    const total = done + remaining;
    detail = `Fail · ${remaining} of ${total} issue${total === 1 ? '' : 's'} still open`;
  } else {
    detail = `Fail · ${log.issueCount} issue${log.issueCount === 1 ? '' : 's'}`;
  }
  return {
    pass,
    score,
    ts: log.completedAt ?? log.createdAt,
    cycleId: log.id,
    cycleName: log.name,
    kind: 'quicklog',
    label: log.name,
    detail,
  };
}

export interface StabilityStats {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  label: 'Stable' | 'At Risk' | 'Unstable' | 'No data';
  trend: 'up' | 'down' | 'flat';
  lastActivity: Date | null;
}

export function stats(points: DataPoint[]): StabilityStats {
  const total = points.length;
  // "Passed"/"failed" stay binary counts (how many points are fully clean)
  // -- it's passRate that's the average of each point's partial-credit
  // score, so a module with several half-resolved quick logs reads as
  // meaningfully better than 0% instead of just "failed".
  const passed = points.filter(p => p.pass).length;
  const failed = total - passed;
  const passRate =
    total === 0 ? 0 : Math.round((points.reduce((sum, p) => sum + p.score, 0) / total) * 100);
  const label: StabilityStats['label'] =
    total === 0 ? 'No data' : passRate >= 90 ? 'Stable' : passRate >= 70 ? 'At Risk' : 'Unstable';
  const lastActivity = total === 0 ? null : new Date(Math.max(...points.map(p => p.ts.getTime())));

  // Trend: compare the average score of the earlier half of data points to
  // the later half. Needs at least 4 points to say anything meaningful.
  let trend: StabilityStats['trend'] = 'flat';
  if (total >= 4) {
    const sorted = [...points].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    const mid = Math.floor(sorted.length / 2);
    const rateOf = (arr: DataPoint[]) =>
      arr.length === 0 ? 0 : (arr.reduce((sum, p) => sum + p.score, 0) / arr.length) * 100;
    const diff = rateOf(sorted.slice(mid)) - rateOf(sorted.slice(0, mid));
    trend = diff >= 5 ? 'up' : diff <= -5 ? 'down' : 'flat';
  }

  return { total, passed, failed, passRate, label, trend, lastActivity };
}
