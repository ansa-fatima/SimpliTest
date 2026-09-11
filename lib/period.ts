// Shared period-filter logic for Reports — used by both the Stability
// report and Cycle History, so the sprint anchor only ever lives in one
// place. Narrows which timestamps count, without needing per-report DB
// query changes: every point/row already carries a `ts`/date, so this is
// just a floor (and sometimes ceiling) applied once after the fetch.

export type Period = 'today' | '7d' | '30d' | 'sprint' | 'all';
export const PERIODS: Period[] = ['today', '7d', '30d', 'sprint', 'all'];
const DAY_MS = 24 * 60 * 60 * 1000;

// Sprints are a fixed 2-week block, not a rolling "last 14 days" — anchored
// to the team's actual current sprint start date, so "this sprint" means
// the same calendar dates for everyone regardless of when they look, the
// way a rolling window can't. Every other sprint boundary (future or past)
// is just this date +/- a whole number of 14-day steps. Re-anchor this
// whenever the team's sprint cadence actually shifts.
export const SPRINT_EPOCH_MS = Date.UTC(2026, 8, 3); // confirmed current-sprint start: 2026-09-03
export const SPRINT_LENGTH_MS = 14 * DAY_MS;

// `end` is null for every period except 'sprint' -- Today/7d/30d/All are all
// open-ended windows that run up to now, but a PAST sprint has a real end
// date (the day the next one started), so without one, "previous sprint"
// would silently include everything from its start through today.
export function getPeriodRange(
  period: Period,
  now: Date,
  sprintOffset: number,
): { start: Date | null; end: Date | null } {
  switch (period) {
    case 'today': {
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      return { start, end: null };
    }
    case '7d':
      return { start: new Date(now.getTime() - 7 * DAY_MS), end: null };
    case '30d':
      return { start: new Date(now.getTime() - 30 * DAY_MS), end: null };
    case 'sprint': {
      const currentSprintIndex = Math.floor((now.getTime() - SPRINT_EPOCH_MS) / SPRINT_LENGTH_MS);
      const index = currentSprintIndex + sprintOffset;
      const start = new Date(SPRINT_EPOCH_MS + index * SPRINT_LENGTH_MS);
      const end = new Date(start.getTime() + SPRINT_LENGTH_MS);
      // The current sprint is still open-ended (runs up to now, not to its
      // theoretical end date, which may be in the future) -- only a sprint
      // that's actually over gets a closed end boundary.
      return { start, end: sprintOffset < 0 ? end : null };
    }
    case 'all':
    default:
      return { start: null, end: null };
  }
}

// Parses the standard ?period=&sprintOffset= query params shared by every
// report route. Clamps sprintOffset to <= 0 so a caller can't page into a
// sprint that hasn't started yet.
export function parsePeriodParams(sp: URLSearchParams): {
  period: Period;
  sprintOffset: number;
  start: Date | null;
  end: Date | null;
} {
  const periodParam = sp.get('period');
  const period: Period = PERIODS.includes(periodParam as Period) ? (periodParam as Period) : 'all';
  const sprintOffsetRaw = Number(sp.get('sprintOffset') ?? '0');
  const sprintOffset = Number.isFinite(sprintOffsetRaw)
    ? Math.min(0, Math.trunc(sprintOffsetRaw))
    : 0;
  const { start, end } = getPeriodRange(period, new Date(), sprintOffset);
  return { period, sprintOffset, start, end };
}
