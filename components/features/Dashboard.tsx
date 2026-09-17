'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { ActivityEvent } from '@/lib/activity';
import { avatarColour, cn, initials, relativeTime } from '@/lib/utils';
import { ActivityFeed } from './ActivityFeed';

interface RecentCycle {
  id: string;
  name: string;
  status: 'Active' | 'Completed' | 'Archived';
  mode?: 'CaseBased' | 'Manual';
  scopeType: 'All' | 'Portal' | 'Module' | 'Suite' | 'Custom';
  scopeName: string | null;
  createdAt: string;
  completedAt?: string | null;
  total: number;
  done: number;
  passRate: number;
  counts: { NotRun: number; Passed: number; Failed: number; Blocked: number; Skipped: number };
  // Who ran it — executedBy (case-based) or loggedBy (quick log), same
  // "name" or "N testers" convention as the Cycle History report.
  tester: string;
  // Manual-cycle metadata
  portalName?: string | null;
  moduleName?: string | null;
  featureName?: string | null;
  issueCount?: number;
}

interface ModuleStabilityRow {
  name: string;
  passRate: number | null;
  totalRuns: number;
  issues: number;
  label: 'Stable' | 'At Risk' | 'Unstable' | 'No data';
  trend: 'up' | 'down' | 'flat';
}

interface RecurringIssue {
  id: string;
  title: string;
  caseNum: number;
  severity: string;
  scopeName: string;
  occurrences: number;
  cycleCount: number;
  lastSeen: string;
}

interface DashboardData {
  totalCases: number;
  runs30d: { total: number; prev: number };
  passRate: { current: number; prev: number; delta: number };
  openFailures: { total: number; newToday: number };
  criticalIssues: number;
  passed30d: { total: number; pctChange: number };
  failed30d: { total: number; pctChange: number };
  blocked30d: { total: number; pctChange: number };
  weeklyRuns: { label: string; pass: number; fail: number; blocked: number; skipped: number }[];
  moduleStability: ModuleStabilityRow[];
  recurringIssues: { total: number; items: RecurringIssue[] };
  recentActivity: ActivityEvent[];
  recentCycles: RecentCycle[];
}

interface DashboardProps {
  onShowTestRuns: () => void;
  onOpenCycle?: (id: string) => void;
  onShowReports?: () => void;
  onShowStabilityReport?: () => void;
  projectId: string | null;
  userName?: string | null;
}

export function Dashboard({
  onShowTestRuns,
  onOpenCycle,
  onShowReports,
  onShowStabilityReport,
  projectId,
  userName,
}: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    (async () => {
      try {
        const url = projectId ? `/api/dashboard?projectId=${projectId}` : '/api/dashboard';
        const d = await api.get<DashboardData>(url);
        setData(d);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg text-sm text-text-3">
        Loading dashboard…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg text-sm text-danger">
        {error || 'Failed to load'}
      </div>
    );
  }

  const greeting =
    new Date().getHours() < 12
      ? 'Good morning'
      : new Date().getHours() < 18
        ? 'Good afternoon'
        : 'Good evening';
  const activeRunsCount = data.recentCycles.filter(c => c.status === 'Active').length;
  // Most-recent Active cycle, if any — recentCycles is already newest-first.
  // Quick logs are never Active (they're Completed the instant they're
  // logged), so this only ever surfaces a CaseBased run.
  const activeCycle = data.recentCycles.find(c => c.status === 'Active') ?? null;

  const failRate30d =
    data.runs30d.total > 0 ? Math.round((data.failed30d.total / data.runs30d.total) * 100) : 0;
  const blockRate30d =
    data.runs30d.total > 0 ? Math.round((data.blocked30d.total / data.runs30d.total) * 100) : 0;

  // Sparkline series for the stat cards -- the same 8-week buckets that
  // feed Execution trend below, so a card's mini chart can never disagree
  // with the full chart it's a preview of.
  const failedSeries = data.weeklyRuns.map(w => w.fail);
  const passRateSeries = data.weeklyRuns.map(w => {
    const total = w.pass + w.fail + w.blocked;
    return total === 0 ? 0 : Math.round((w.pass / total) * 100);
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      {/* Content */}
      <div className="flex-1 overflow-y-auto px-44 py-6">
        <div className="mb-5">
          <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">
            Dashboard
          </h1>
          <p className="text-[13px] text-text-2">
            Simplitest — Test Management Platform · what&apos;s going on right now.
          </p>
        </div>

        <GreetingBanner
          greeting={greeting}
          userName={userName}
          activeCount={activeRunsCount}
          openFailuresTotal={data.openFailures.total}
          onShowTestRuns={onShowTestRuns}
        />

        {/* KPI row — total cases, 30d failed, pass rate, critical issues,
            recurring issues. */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard label="Total Test Cases" value={data.totalCases.toLocaleString()} />
          <KpiCard
            label="Failed (30d)"
            value={data.failed30d.total.toLocaleString()}
            trendPct={data.failed30d.pctChange}
            spark={failedSeries}
            sparkColor="#DC2626"
          />
          <KpiCard
            label="Pass Rate"
            value={`${data.passRate.current}%`}
            trendPct={data.passRate.delta}
            spark={passRateSeries}
            sparkColor="#16A34A"
          />
          <KpiCard
            label="Critical Issues"
            value={data.criticalIssues.toLocaleString()}
            meta="open · Critical severity"
            tone={data.criticalIssues > 0 ? 'danger' : undefined}
          />
          <KpiCard
            label="Recurring Issues"
            value={data.recurringIssues.total.toLocaleString()}
            meta="failed in 2+ cycles"
            tone={data.recurringIssues.total > 0 ? 'warning' : undefined}
          />
        </div>

        {activeCycle && <ActiveRunHero cycle={activeCycle} onOpen={onOpenCycle} />}

        {/* Execution trend + Cycle-wise test distribution */}
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Panel
            title="Execution Trend"
            secondary="Last 8 weeks — executed, passed, failed and blocked"
          >
            <TrendChart weekly={data.weeklyRuns} />
          </Panel>

          <ResultDistributionPanel data={data} />
        </div>

        {/* Coverage by module — full-width table, worst-covered first */}
        <div className="mb-4">
          <Panel
            title="Coverage by Module"
            secondary="Worst-covered first"
            action={
              onShowStabilityReport && (
                <button
                  type="button"
                  onClick={onShowStabilityReport}
                  className="text-[12px] font-medium text-primary-text hover:underline"
                >
                  Full stability report →
                </button>
              )
            }
          >
            {data.moduleStability.length === 0 ? (
              <p className="text-[12.5px] text-text-3">No module activity yet.</p>
            ) : (
              <CoverageTable modules={data.moduleStability} limit={5} />
            )}
          </Panel>
        </div>

        {/* Recent test runs */}
        <div className="mb-4">
          <Panel
            title="Recent test runs"
            action={
              onShowTestRuns && (
                <button
                  type="button"
                  onClick={onShowTestRuns}
                  className="text-[12px] font-medium text-primary-text hover:underline"
                >
                  View all test runs →
                </button>
              )
            }
          >
            {data.recentCycles.length === 0 ? (
              <p className="text-[13px] text-text-3">
                Nothing yet.{' '}
                <button onClick={onShowTestRuns} className="text-primary hover:underline">
                  Create a test run
                </button>{' '}
                to get started.
              </p>
            ) : (
              <RecentRunsTable cycles={data.recentCycles.slice(0, 4)} onOpen={onOpenCycle} />
            )}
          </Panel>
        </div>

        {/* Recurring issues + Recent activity */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel
            title="Recurring Issues"
            secondary="Failed in 2+ separate test runs"
            action={
              onShowReports && (
                <button
                  type="button"
                  onClick={onShowReports}
                  className="text-[12px] font-medium text-primary-text hover:underline"
                >
                  Full report →
                </button>
              )
            }
          >
            {data.recurringIssues.items.length === 0 ? (
              <p className="text-[12.5px] text-text-3">No recurring issues right now.</p>
            ) : (
              <RecurringIssuesList items={data.recurringIssues.items} />
            )}
          </Panel>

          <Panel title="Recent Activity" secondary="Live from the QA team">
            {data.recentActivity.length === 0 ? (
              <p className="text-[12.5px] text-text-3">No activity yet.</p>
            ) : (
              <ActivityFeed events={data.recentActivity} />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ─── helper components ───────────────────────────────────

function KpiCard({
  label,
  value,
  trendPct,
  meta,
  spark,
  sparkColor,
  tone,
}: {
  label: string;
  value: string;
  // Signed % change vs. the prior period. Sign alone decides the arrow/colour
  // -- a falling Failed count is still a numeric "down", shown the same way
  // a rising one would be, not recoloured for being good news.
  trendPct?: number;
  meta?: string;
  spark?: number[];
  sparkColor?: string;
  // For cards with no prior-period figure to trend against (a live snapshot
  // like Critical/Recurring issues) -- colours the value itself instead.
  tone?: 'danger' | 'warning';
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-[16px_18px]">
      <div className="mb-2 text-[12px] font-medium text-text-3">{label}</div>
      <div
        className={cn(
          'mb-2 text-[26px] font-semibold tracking-[-0.02em]',
          tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-text',
        )}
      >
        {value}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[11.5px] font-medium">
          {trendPct !== undefined && (
            <span className={trendPct >= 0 ? 'text-success' : 'text-danger'}>
              {trendPct >= 0 ? '↗' : '↘'} {trendPct >= 0 ? '+' : ''}
              {trendPct}%{meta ? '' : ' vs prior 30d'}
            </span>
          )}
          {meta && <span className={trendPct !== undefined ? 'text-text-3' : ''}>{meta}</span>}
        </div>
        {spark && spark.length > 1 && <Sparkline values={spark} color={sparkColor ?? '#6B7280'} />}
      </div>
    </div>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 80;
  const h = 24;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[24px] w-[80px] flex-shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" />
    </svg>
  );
}

// ─── Greeting banner ──────────────────────────────────────

function GreetingBanner({
  greeting,
  userName,
  activeCount,
  openFailuresTotal,
  onShowTestRuns,
}: {
  greeting: string;
  userName?: string | null;
  activeCount: number;
  openFailuresTotal: number;
  onShowTestRuns: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="mb-6 flex items-start gap-4 rounded-lg border border-primary/20 bg-primary-light px-5 py-4">
      <div className="flex-1">
        <div className="text-[13.5px] text-primary-text">
          <b className="font-semibold">{activeCount}</b> test run{activeCount === 1 ? '' : 's'}{' '}
          currently in progress, and <b className="font-semibold">{openFailuresTotal}</b> failure
          {openFailuresTotal === 1 ? '' : 's'} open right now.
          <span className="ml-1 text-text-3">
            ({greeting}
            {userName ? `, ${userName}` : ''} 👋)
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onShowTestRuns}
        className="flex-shrink-0 text-[12.5px] font-semibold text-primary-text hover:underline"
      >
        Go to Test Runs →
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="flex-shrink-0 text-primary-text/50 transition-colors hover:text-primary-text"
      >
        <i className="ti ti-x text-[16px]" />
      </button>
    </div>
  );
}

// ─── Active test run hero ─────────────────────────────────

function ActiveRunHero({ cycle, onOpen }: { cycle: RecentCycle; onOpen?: (id: string) => void }) {
  const executedPct = cycle.total > 0 ? Math.round((cycle.done / cycle.total) * 100) : 0;
  return (
    <div className="mb-4 rounded-lg border-2 border-primary bg-surface p-[18px_20px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-2.5 py-1 text-[11px] font-semibold text-primary-text">
          <span className="h-[6px] w-[6px] rounded-full bg-primary" />
          Active Test Run
        </span>
        <button
          type="button"
          onClick={() => onOpen?.(cycle.id)}
          className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-all hover:bg-primary-hover"
        >
          <i className="ti ti-player-play text-[13px]" />
          Continue
        </button>
      </div>
      <div className="mb-1 truncate text-[17px] font-semibold text-text">{cycle.name}</div>
      <div className="mb-3 text-[12.5px] text-text-3">
        Scope: {cycle.scopeName ?? (cycle.scopeType === 'All' ? 'All cases' : cycle.scopeType)}
      </div>
      <div className="mb-1.5 h-[8px] overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-primary" style={{ width: `${executedPct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[12px] text-text-3">
        <span>
          {cycle.done} / {cycle.total} executed
        </span>
        <span>
          Pass rate <b className="font-semibold text-text">{cycle.passRate}%</b>
        </span>
      </div>
    </div>
  );
}

// ─── Execution trend (line chart) ─────────────────────────

function TrendChart({ weekly }: { weekly: DashboardData['weeklyRuns'] }) {
  const W = 600;
  const H = 190;
  const padL = 34;
  const padB = 18;
  const executed = weekly.map(w => w.pass + w.fail + w.blocked);
  const max = Math.max(...executed, 1);
  // Round the axis ceiling up to a tidy number so the gridline labels read
  // like real values, not an arbitrary max-of-the-data.
  const niceMax = Math.ceil(max / 50) * 50 || 50;
  const ySteps = 4;

  const x = (i: number) => padL + (i / Math.max(weekly.length - 1, 1)) * (W - padL);
  const y = (n: number) => H - padB - (n / niceMax) * (H - padB);

  const line = (vals: number[]) => vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[200px] w-full">
        <g stroke="#E7E5E4" strokeWidth="1">
          {Array.from({ length: ySteps + 1 }, (_, i) => {
            const val = (niceMax / ySteps) * i;
            return <line key={i} x1={padL} y1={y(val)} x2={W} y2={y(val)} />;
          })}
        </g>
        <g fontSize="10" fill="#A8A29E" fontFamily="ui-monospace, monospace">
          {Array.from({ length: ySteps + 1 }, (_, i) => {
            const val = Math.round((niceMax / ySteps) * i);
            return (
              <text key={i} x={0} y={y(val) + 3}>
                {val}
              </text>
            );
          })}
        </g>
        <polyline fill="none" stroke="#6366F1" strokeWidth="2" points={line(executed)} />
        <polyline
          fill="none"
          stroke="#16A34A"
          strokeWidth="2"
          points={line(weekly.map(w => w.pass))}
        />
        <polyline
          fill="none"
          stroke="#DC2626"
          strokeWidth="2"
          points={line(weekly.map(w => w.fail))}
        />
        <polyline
          fill="none"
          stroke="#D97706"
          strokeWidth="2"
          points={line(weekly.map(w => w.blocked))}
        />
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-[12px] text-text-2">
        <LegendDot color="#6366F1" label="Executed" />
        <LegendDot color="#16A34A" label="Passed" />
        <LegendDot color="#DC2626" label="Failed" />
        <LegendDot color="#D97706" label="Blocked" />
      </div>
    </div>
  );
}

export function DonutChart({
  pass,
  fail,
  block,
  value,
  sublabel = 'pass rate',
}: {
  pass: number;
  fail: number;
  block: number;
  value: string;
  sublabel?: string;
}) {
  const r = 15.9;
  const circumference = 100;
  let offset = 25; // start at 12 o'clock
  const seg = (pct: number, color: string) => {
    const dash = `${pct} ${circumference - pct}`;
    const el = (
      <circle
        key={color}
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3.5"
        strokeDasharray={dash}
        strokeDashoffset={-offset + 25}
        transform="rotate(-90 18 18)"
      />
    );
    offset += pct;
    return el;
  };
  return (
    <svg viewBox="0 0 36 36" className="h-[150px] w-[150px]">
      <circle cx="18" cy="18" r={r} fill="none" stroke="#EEEDEB" strokeWidth="3.5" />
      {seg(pass, '#16A34A')}
      {seg(fail, '#DC2626')}
      {seg(block, '#D97706')}
      <text x="18" y="17.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#1C1917">
        {value}
      </text>
      <text x="18" y="22.5" textAnchor="middle" fontSize="2.4" fill="#A8A29E">
        {sublabel}
      </text>
    </svg>
  );
}

function SummaryRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-text-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="font-mono tabular-nums text-text">{value.toLocaleString()}</span>
    </div>
  );
}

// ─── Cycle-wise test distribution ─────────────────────────

// Overall Passed/Failed/Blocked mix over the last 30 days -- blended
// CaseBased + quick-log counts, same 30d window and numbers already shown
// in the KPI row above, just visualized as a share of the whole instead of
// three separate cards. Not run/skipped aren't a verdict, so they're left
// out of the denominator (same convention as the KPI row's own pass rate).
function ResultDistributionPanel({ data }: { data: DashboardData }) {
  const passed = data.passed30d.total;
  const failed = data.failed30d.total;
  const blocked = data.blocked30d.total;
  const total = passed + failed + blocked;
  const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  if (total === 0) {
    return (
      <Panel title="Result Distribution" secondary="Last 30 days">
        <p className="text-[12.5px] text-text-3">No results in the last 30 days.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Result Distribution" secondary="Last 30 days">
      <div className="flex flex-col items-center gap-4">
        <DonutChart
          pass={pctOf(passed)}
          fail={pctOf(failed)}
          block={pctOf(blocked)}
          value={`${pctOf(passed)}%`}
        />
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[13px]">
          <LegendItem color="#16A34A" label="Passed" value={passed} />
          <LegendItem color="#DC2626" label="Failed" value={failed} />
          <LegendItem color="#D97706" label="Blocked" value={blocked} />
        </div>
      </div>
    </Panel>
  );
}

function LegendItem({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5 text-text-2">
      <span
        className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
        style={{ background: color }}
      />
      {label} <span className="font-mono tabular-nums text-text">{value.toLocaleString()}</span>
    </span>
  );
}

// ─── Recurring issues ──────────────────────────────────────

function RecurringIssuesList({ items }: { items: RecurringIssue[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {items.map(i => (
        <div
          key={i.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-text-3">
                TC-{String(i.caseNum).padStart(3, '0')}
              </span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                  i.severity === 'Critical'
                    ? 'bg-danger-bg text-danger-text'
                    : i.severity === 'Major'
                      ? 'bg-warning-bg text-warning-text'
                      : 'bg-surface-3 text-text-3',
                )}
              >
                {i.severity}
              </span>
            </div>
            <div className="truncate text-[12.5px] font-medium text-text">{i.title}</div>
            <div className="truncate text-[11px] text-text-3">{i.scopeName}</div>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="text-[12.5px] font-semibold text-danger">{i.cycleCount}× cycles</div>
            <div className="text-[10.5px] text-text-3">{relativeTime(i.lastSeen)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Coverage by module (full table) ──────────────────────

function CoverageTable({ modules, limit }: { modules: ModuleStabilityRow[]; limit?: number }) {
  const sorted = [...modules]
    .filter(m => m.passRate !== null)
    .sort((a, b) => (a.passRate ?? 0) - (b.passRate ?? 0));
  const rows = limit ? sorted.slice(0, limit) : sorted;
  const labelTone: Record<ModuleStabilityRow['label'], string> = {
    Stable: 'text-success',
    'At Risk': 'text-warning',
    Unstable: 'text-danger',
    'No data': 'text-text-3',
  };
  const barTone: Record<ModuleStabilityRow['label'], string> = {
    Stable: 'bg-success',
    'At Risk': 'bg-warning',
    Unstable: 'bg-danger',
    'No data': 'bg-surface-3',
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-text-3">
            <th className="border-b border-border pb-2 pr-3">Module</th>
            <th className="border-b border-border pb-2 pr-3">Pass rate</th>
            <th className="border-b border-border pb-2 pr-3 text-right">Issues</th>
            <th className="border-b border-border pb-2 pr-3">Stability</th>
            <th className="border-b border-border pb-2">Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(m => (
            <tr key={m.name} className="border-b border-border last:border-b-0">
              <td className="py-2.5 pr-3 font-medium text-text">{m.name}</td>
              <td className="py-2.5 pr-3">
                <div className="flex items-center gap-2">
                  <span className="w-9 flex-shrink-0 font-mono text-[11.5px] text-text-2">
                    {m.passRate}%
                  </span>
                  <div className="h-[6px] w-[90px] overflow-hidden rounded-full bg-surface-3">
                    <div
                      className={cn('h-full rounded-full', barTone[m.label])}
                      style={{ width: `${Math.max(m.passRate ?? 0, 2)}%` }}
                    />
                  </div>
                </div>
              </td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-text-2">
                {m.issues}
              </td>
              <td className="py-2.5 pr-3">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 font-semibold',
                    labelTone[m.label],
                  )}
                >
                  <span className={cn('h-[6px] w-[6px] rounded-full', barTone[m.label])} />
                  {m.label}
                </span>
              </td>
              <td className="py-2.5">
                <i
                  className={cn(
                    'ti text-[15px]',
                    m.trend === 'up'
                      ? 'ti-trending-up text-success'
                      : m.trend === 'down'
                        ? 'ti-trending-down text-danger'
                        : 'ti-minus text-text-3',
                  )}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({
  title,
  secondary,
  action,
  children,
}: {
  title: string;
  secondary?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-[18px_20px]">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-text">{title}</div>
          {secondary && <div className="mt-0.5 text-[12px] text-text-3">{secondary}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function RecentRunsTable({
  cycles,
  onOpen,
}: {
  cycles: RecentCycle[];
  onOpen?: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-text-3">
            <th className="border-b border-border pb-2 pr-3">Run</th>
            <th className="border-b border-border pb-2 pr-3">Progress</th>
            <th className="border-b border-border pb-2 pr-3">Result</th>
            <th className="border-b border-border pb-2">Tester</th>
          </tr>
        </thead>
        <tbody>
          {cycles.slice(0, 8).map(c => (
            <RecentRunRow key={c.id} cycle={c} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentRunRow({ cycle: c, onOpen }: { cycle: RecentCycle; onOpen?: (id: string) => void }) {
  const isManual = c.mode === 'Manual';
  // Quick-log entries don't have per-case runs — express the outcome as a
  // single Pass/Fail. Read the verdict the API already computed into
  // `counts` (tracked/untracked Done-Remaining rule) instead of
  // re-deriving it from issueCount here, which would silently disagree
  // with the API the moment a quick log gets retested and resolved.
  //
  // A case-based run gets the same Pass/Fail badge once it's no longer
  // Active — auto-complete guarantees a Completed run has NotRun === 0, so
  // "any case still Failed or Blocked" is always a fully-informed verdict,
  // not one diluted by cases nobody's run yet. Still-Active runs show no
  // verdict at all (there isn't one yet), same as before.
  const verdict = isManual
    ? c.counts.Passed > 0
      ? { label: 'Pass', tone: 'text-emerald-700 bg-emerald-50' }
      : { label: 'Fail', tone: 'text-red-700 bg-red-50' }
    : c.status !== 'Active'
      ? c.counts.Failed + c.counts.Blocked === 0
        ? { label: 'Pass', tone: 'text-emerald-700 bg-emerald-50' }
        : { label: 'Fail', tone: 'text-red-700 bg-red-50' }
      : null;
  // Manual cycles store their scope as free text instead of an id — fall
  // back to that when scopeName isn't set.
  const subText = isManual
    ? [c.portalName, c.moduleName, c.featureName].filter(Boolean).join(' › ') || 'quick log'
    : c.scopeType === 'All'
      ? 'all cases'
      : (c.scopeName ?? c.scopeType);
  // Manual rows want their completed-on date so back-dated entries read
  // correctly; CaseBased keep the createdAt.
  const dateIso = (isManual && c.completedAt) || c.createdAt;
  // A cycle attributed to more than one tester reads as "N testers" (see
  // /api/dashboard) rather than a real name -- shown with a group icon
  // instead of misleading two-letter initials taken from that phrase.
  const isGroup = /\d+ testers$/.test(c.tester);

  return (
    <tr
      onClick={() => onOpen?.(c.id)}
      className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-2"
    >
      <td className="max-w-[240px] py-2.5 pr-3">
        <div className="truncate font-medium text-text">{c.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-3">
          <span className="truncate">{subText}</span>
          <span>·</span>
          <span className="flex-shrink-0">{relativeTime(dateIso)}</span>
        </div>
      </td>
      <td className="py-2.5 pr-3">
        {isManual ? (
          <span className="text-[11px] text-text-3">quick log</span>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-[6px] w-[70px] overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${c.total > 0 ? Math.round((c.done / c.total) * 100) : 0}%` }}
              />
            </div>
            <span className="flex-shrink-0 text-[11px] text-text-3">
              {c.done}/{c.total} · {c.passRate}%
            </span>
          </div>
        )}
      </td>
      <td className="py-2.5 pr-3">
        {verdict ? (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
              verdict.tone,
            )}
          >
            {verdict.label}
            {(c.issueCount ?? 0) > 0 && ` · ${c.issueCount} issue${c.issueCount === 1 ? '' : 's'}`}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-light px-2 py-0.5 text-[10.5px] font-semibold text-primary-text">
            <span className="h-[6px] w-[6px] rounded-full bg-primary" />
            Active
          </span>
        )}
      </td>
      <td className="py-2.5">
        {!c.tester ? (
          <span className="text-[11.5px] text-text-3">Unattributed</span>
        ) : isGroup ? (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-text-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-3 text-text-3">
              <i className="ti ti-users text-[11px]" />
            </span>
            {c.tester}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-text-2">
            <span
              className={cn(
                'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                avatarColour(c.tester),
              )}
            >
              {initials(c.tester)}
            </span>
            <span className="truncate">{c.tester}</span>
          </span>
        )}
      </td>
    </tr>
  );
}
