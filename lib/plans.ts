// Shared test-plan maths -- a plan owns no results of its own; everything on the
// screens (progress, pass rate, status, burn-down) is rolled up from the runs
// linked to it, so the board, the plan page and the API can never disagree.
import type { PlanBurndown, RunResult, TestCycle, TestPlan } from '@/types';

export interface PlanRollup {
  runs: number;
  total: number;
  done: number;
  counts: Record<RunResult, number>;
  /** Passed / executed, or null before anything has been executed. */
  passRate: number | null;
  /** 0-100, executed / total. */
  percent: number;
  /** Cases that have ever failed or been blocked (the stable "defects" baseline). */
  issuesFound: number;
  /** Distinct testers who have executed cases in the plan's runs. */
  testers: number;
}

export function rollUpPlan(cycles: TestCycle[]): PlanRollup {
  const counts: Record<RunResult, number> = {
    NotRun: 0,
    Passed: 0,
    Failed: 0,
    Blocked: 0,
    Skipped: 0,
  };
  let total = 0;
  let done = 0;
  let issuesFound = 0;
  const testers = new Set<string>();
  for (const c of cycles) {
    const s = c.summary;
    if (!s) continue;
    total += s.total;
    done += s.done;
    issuesFound += s.issuesFound ?? 0;
    (Object.keys(counts) as RunResult[]).forEach(k => {
      counts[k] += s.counts[k] ?? 0;
    });
    if (c.tester) testers.add(c.tester);
  }
  return {
    runs: cycles.length,
    total,
    done,
    counts,
    passRate: done === 0 ? null : (counts.Passed / done) * 100,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    issuesFound,
    testers: testers.size,
  };
}

export type PlanState = 'Planned' | 'In progress' | 'Completed' | 'Archived';

// "Planned" and "In progress" are not stored -- an Active plan reads as In progress
// once any of its cases has a verdict, the same rule a run uses.
export function planStateOf(plan: Pick<TestPlan, 'status'>, rollup: PlanRollup): PlanState {
  if (plan.status === 'Completed') return 'Completed';
  if (plan.status === 'Archived') return 'Archived';
  return rollup.done > 0 ? 'In progress' : 'Planned';
}

export function planPillOf(state: PlanState): { pill: string; dot: boolean } {
  switch (state) {
    case 'In progress':
      return { pill: 'pill-brand', dot: true };
    case 'Completed':
      return { pill: 'pill-ok', dot: true };
    case 'Planned':
      return { pill: 'pill-neutral', dot: true };
    default:
      return { pill: 'pill-neutral', dot: false };
  }
}

/** "2.4.0" and "v2.4.0" both read "v2.4.0". */
export function milestoneLabel(m: string | null | undefined): string | null {
  const v = (m ?? '').trim();
  return v ? `v${v.replace(/^v\s*/i, '')}` : null;
}

/** "May 1" -- the mockup's compact date. */
export function shortDate(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Fri May 9" -- the due date in the plan header. */
export function dueDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "2h ago" / "3d ago" -- when a run last moved. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(iso);
}

// ─── Burn-down ──────────────────────────────────────────────

const DAY = 86_400_000;
const MAX_DAYS = 120;

function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Cases still to execute at the end of each day. A case counts as executed from the
 * day it got a verdict (executedAt), so the line only ever falls -- a case that is
 * re-run later keeps its latest date, which is close enough for a plan-level trend.
 */
export function buildBurndown(
  runs: { result: RunResult; executedAt: Date | null }[],
  startAt: Date,
  dueAt: Date | null,
  now: Date,
): PlanBurndown {
  const total = runs.length;
  const start = startOfDay(startAt);
  const today = startOfDay(now);
  // The axis ends on the due date; without one it covers a working week (or however
  // long the plan has already run) so the chart is never a single dot.
  let end = dueAt
    ? startOfDay(dueAt)
    : new Date(Math.max(today.getTime(), start.getTime() + 6 * DAY));
  if (end.getTime() < start.getTime()) end = start;
  if ((end.getTime() - start.getTime()) / DAY > MAX_DAYS)
    end = new Date(start.getTime() + MAX_DAYS * DAY);

  const executedOn = new Map<string, number>();
  let before = 0;
  for (const r of runs) {
    if (r.result === 'NotRun' || !r.executedAt) continue;
    const at = startOfDay(r.executedAt);
    if (at.getTime() < start.getTime()) {
      before++;
      continue;
    }
    const k = dayKey(at);
    executedOn.set(k, (executedOn.get(k) ?? 0) + 1);
  }

  const points: { date: string; remaining: number }[] = [];
  let executed = before;
  const last = new Date(Math.min(today.getTime(), end.getTime()));
  for (let t = start.getTime(); t <= last.getTime(); t += DAY) {
    const k = dayKey(new Date(t));
    executed += executedOn.get(k) ?? 0;
    points.push({ date: k, remaining: Math.max(0, total - executed) });
  }
  if (points.length === 0) points.push({ date: dayKey(start), remaining: total });

  return {
    total,
    points,
    start: dayKey(start),
    end: dayKey(end),
    hasDue: !!dueAt,
  };
}
