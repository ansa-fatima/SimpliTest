import type { TestCycle } from '@/types';

// "Planned" isn't a real DB status -- it's an Active cycle nobody has
// started executing yet (0 runs touched). Once at least one run has a
// verdict, it reads as "In Progress" instead.
export function isStarted(c: TestCycle): boolean {
  return (c.summary?.done ?? 0) > 0;
}

export function runStatus(c: TestCycle): { label: string; pill: string; dot: boolean } {
  if (c.status === 'Completed') return { label: 'Closed', pill: 'pill-ok', dot: true };
  if (c.status === 'Archived') return { label: 'Archived', pill: 'pill-neutral', dot: false };
  if (!isStarted(c)) return { label: 'Planned', pill: 'pill-neutral', dot: true };
  const counts = c.summary?.counts;
  const done = c.summary?.done ?? 0;
  if (counts && done > 0 && counts.Failed / done >= 0.25)
    return { label: 'Failing', pill: 'pill-err', dot: true };
  if (counts && counts.Blocked > 0 && counts.Blocked >= counts.Failed)
    return { label: 'Blocked', pill: 'pill-warn', dot: true };
  return { label: 'Running', pill: 'pill-info', dot: true };
}

/** Green / amber / red the way the mockup tints a pass rate. */
export function passRateColour(rate: number | null): string {
  if (rate === null) return 'var(--t-4)';
  return rate >= 85 ? 'var(--ok)' : rate >= 60 ? 'var(--warn)' : 'var(--err)';
}
