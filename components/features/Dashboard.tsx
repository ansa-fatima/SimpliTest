'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { cn, relativeTime } from '@/lib/utils';
import { useTheme } from '@/lib/theme';

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
  // Manual-cycle metadata
  portalName?: string | null;
  moduleName?: string | null;
  featureName?: string | null;
  issueCount?: number;
}

interface DashboardData {
  totalCases: number;
  runs30d: { total: number; prev: number };
  passRate: { current: number; prev: number; delta: number };
  openFailures: { total: number; newToday: number };
  weeklyRuns: { label: string; pass: number; fail: number; blocked: number; skipped: number }[];
  moduleStability: { name: string; passRate: number | null; totalRuns: number }[];
  recentCycles: RecentCycle[];
}

interface DashboardProps {
  onShowTestRuns: () => void;
  onOpenCycle?: (id: string) => void;
  projectId: string | null;
}

export function Dashboard({ onShowTestRuns, onOpenCycle, projectId }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { theme, toggle: toggleTheme } = useTheme();

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

  // Donut totals from the last-30d window
  const totalRecent = data.runs30d.total || 1;
  const passed = data.recentCycles.reduce((s, c) => s + c.counts.Passed, 0);
  const failed = data.recentCycles.reduce((s, c) => s + c.counts.Failed, 0);
  const blocked = data.recentCycles.reduce((s, c) => s + c.counts.Blocked, 0);
  const untested = data.recentCycles.reduce((s, c) => s + c.counts.NotRun + c.counts.Skipped, 0);
  const allRuns = passed + failed + blocked + untested;
  const pctPass = allRuns > 0 ? Math.round((passed / allRuns) * 100) : 0;
  const pctFail = allRuns > 0 ? Math.round((failed / allRuns) * 100) : 0;
  const pctBlock = allRuns > 0 ? Math.round((blocked / allRuns) * 100) : 0;
  const pctUntested = allRuns > 0 ? 100 - pctPass - pctFail - pctBlock : 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      {/* Topbar */}
      <div className="flex items-center justify-end gap-3 border-b border-border bg-surface px-6 py-3">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[7px] border border-border bg-surface text-text-2 transition-all hover:bg-surface-2 hover:text-text"
        >
          <i className={cn('text-[17px]', theme === 'dark' ? 'ti ti-moon' : 'ti ti-sun')} />
        </button>
        <button
          onClick={onShowTestRuns}
          className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-[7px] text-[13px] font-medium text-white transition-colors hover:bg-primary-hover"
        >
          <i className="ti ti-plus text-[16px]" />
          New test run
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">
            {greeting} 👋
          </h1>
          <div className="text-[13px] text-text-2">
            Here&apos;s what&apos;s happening across QA today.
          </div>
        </div>

        {/* KPI grid */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon="ti-checklist"
            label="Total cases"
            value={data.totalCases.toLocaleString()}
            delta={`${data.totalCases > 0 ? '↗' : '—'} ${data.totalCases} total`}
            deltaTone="neutral"
          />
          <KpiCard
            icon="ti-check"
            label="Pass rate"
            value={`${data.passRate.current}%`}
            delta={
              data.runs30d.prev === 0
                ? 'no prev data'
                : `${data.passRate.delta >= 0 ? '↑' : '↓'} ${Math.abs(data.passRate.delta)}% vs prev`
            }
            deltaTone={data.passRate.delta >= 0 ? 'up' : 'down'}
          />
          <KpiCard
            icon="ti-bug"
            label="Open failures"
            value={data.openFailures.total.toLocaleString()}
            delta={
              data.openFailures.newToday > 0
                ? `↑ ${data.openFailures.newToday} new today`
                : 'No new today'
            }
            deltaTone={data.openFailures.total > 0 ? 'down' : 'up'}
          />
          <KpiCard
            icon="ti-player-play"
            label="Active runs"
            value={activeRunsCount.toLocaleString()}
            delta={
              data.recentCycles.length > 0 ? `${data.recentCycles.length} total recent` : 'none yet'
            }
            deltaTone="neutral"
          />
        </div>

        {/* Trend + Summary row */}
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Panel title="Execution trend" secondary="Last 8 weeks">
            <TrendChart weekly={data.weeklyRuns} />
            <div className="mt-2 flex gap-4 text-[12px] text-text-2">
              <LegendDot color="#16A34A" label="Pass" />
              <LegendDot color="#DC2626" label="Fail" />
              <LegendDot color="#EA580C" label="Blocked" />
            </div>
          </Panel>

          <Panel title="Execution summary" secondary="Recent runs">
            <div className="flex items-center gap-5">
              <DonutChart pass={pctPass} fail={pctFail} block={pctBlock} value={`${pctPass}%`} />
              <div className="flex flex-1 flex-col gap-2 text-[13px]">
                <SummaryRow color="#16A34A" label="Pass" value={`${pctPass}%`} />
                <SummaryRow color="#DC2626" label="Fail" value={`${pctFail}%`} />
                <SummaryRow color="#EA580C" label="Blocked" value={`${pctBlock}%`} />
                <SummaryRow color="#E7E5E4" label="Untested" value={`${pctUntested}%`} />
              </div>
            </div>
          </Panel>
        </div>

        {/* Recent activity */}
        <Panel
          title="Recent activity"
          secondary={
            data.recentCycles.length > 0 ? `${data.recentCycles.length} recent` : undefined
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
            <div className="divide-y divide-border">
              {data.recentCycles.slice(0, 8).map(c => (
                <ActivityRow key={c.id} cycle={c} onOpen={onOpenCycle} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ─── helper components ───────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  delta,
  deltaTone,
}: {
  icon: string;
  label: string;
  value: string;
  delta: string;
  deltaTone: 'up' | 'down' | 'neutral';
}) {
  const tone =
    deltaTone === 'up' ? 'text-success' : deltaTone === 'down' ? 'text-danger' : 'text-text-3';
  return (
    <div className="rounded-lg border border-border bg-surface p-[16px_18px]">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-text-2">
        <i className={`ti ${icon} text-[14px]`} />
        {label}
      </div>
      <div className="mb-1 text-[28px] font-semibold tracking-[-0.02em] text-text">{value}</div>
      <div className={`flex items-center gap-1 text-[12px] ${tone}`}>{delta}</div>
    </div>
  );
}

function Panel({
  title,
  secondary,
  children,
}: {
  title: string;
  secondary?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-[18px_20px]">
      <div className="mb-3.5 flex items-center justify-between text-[14px] font-semibold text-text">
        <span>{title}</span>
        {secondary && <span className="text-[12px] font-normal text-text-3">{secondary}</span>}
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

function SummaryRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="font-mono tabular-nums text-text-2">{value}</span>
    </div>
  );
}

function TrendChart({ weekly }: { weekly: DashboardData['weeklyRuns'] }) {
  const W = 600;
  const H = 160;
  const max = Math.max(...weekly.map(w => w.pass + w.fail + w.blocked), 1);

  const x = (i: number) => (i / Math.max(weekly.length - 1, 1)) * W;
  const y = (n: number) => H - (n / max) * (H - 20) - 10;

  const passPts = weekly.map((w, i) => `${x(i)},${y(w.pass)}`).join(' ');
  const failPts = weekly.map((w, i) => `${x(i)},${y(w.fail)}`).join(' ');
  const blockedPts = weekly.map((w, i) => `${x(i)},${y(w.blocked)}`).join(' ');
  const passAreaPath =
    `M ${x(0)},${H} ` +
    weekly.map((w, i) => `L ${x(i)},${y(w.pass)}`).join(' ') +
    ` L ${x(weekly.length - 1)},${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[160px] w-full">
      <defs>
        <linearGradient id="passGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#16A34A" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#16A34A" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="#E7E5E4" strokeWidth="1">
        <line x1="0" y1="40" x2={W} y2="40" />
        <line x1="0" y1="80" x2={W} y2="80" />
        <line x1="0" y1="120" x2={W} y2="120" />
      </g>
      <path d={passAreaPath} fill="url(#passGrad)" />
      <polyline fill="none" stroke="#16A34A" strokeWidth="2" points={passPts} />
      <polyline fill="none" stroke="#DC2626" strokeWidth="2" points={failPts} />
      <polyline fill="none" stroke="#EA580C" strokeWidth="2" points={blockedPts} />
      {weekly.map((w, i) => (
        <text key={i} x={x(i)} y={H - 2} textAnchor="middle" fontSize="9" fill="#A8A29E">
          {w.label}
        </text>
      ))}
    </svg>
  );
}

function DonutChart({
  pass,
  fail,
  block,
  value,
}: {
  pass: number;
  fail: number;
  block: number;
  value: string;
}) {
  return (
    <svg width="120" height="120" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#F5F5F4" strokeWidth="3.5" />
      <circle
        cx="18"
        cy="18"
        r="15.9"
        fill="none"
        stroke="#16A34A"
        strokeWidth="3.5"
        strokeDasharray={`${pass} 100`}
        strokeDashoffset="25"
        transform="rotate(-90 18 18)"
        strokeLinecap="round"
      />
      <circle
        cx="18"
        cy="18"
        r="15.9"
        fill="none"
        stroke="#DC2626"
        strokeWidth="3.5"
        strokeDasharray={`${fail} 100`}
        strokeDashoffset={-(pass - 25)}
        transform="rotate(-90 18 18)"
        strokeLinecap="round"
      />
      <circle
        cx="18"
        cy="18"
        r="15.9"
        fill="none"
        stroke="#EA580C"
        strokeWidth="3.5"
        strokeDasharray={`${block} 100`}
        strokeDashoffset={-(pass + fail - 25)}
        transform="rotate(-90 18 18)"
        strokeLinecap="round"
      />
      <text x="18" y="20" textAnchor="middle" fontSize="6" fill="#1C1917" fontWeight="600">
        {value}
      </text>
    </svg>
  );
}

function ActivityRow({ cycle: c, onOpen }: { cycle: RecentCycle; onOpen?: (id: string) => void }) {
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

  const status = verdict
    ? verdict.label === 'Pass'
      ? { icon: 'ti-check', tone: 'bg-emerald-50 text-emerald-600' }
      : { icon: 'ti-x', tone: 'bg-red-50 text-red-600' }
    : { icon: 'ti-player-play', tone: 'bg-indigo-50 text-indigo-600' };

  return (
    <button
      onClick={() => onOpen?.(c.id)}
      className="flex w-full items-start gap-3 py-2.5 text-left transition-colors hover:bg-surface-2"
    >
      <span
        className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
          status.tone,
        )}
      >
        <i className={cn('ti', status.icon, 'text-[15px]')} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-text">{c.name}</span>
          <span className="flex-shrink-0 text-[11.5px] text-text-3">{relativeTime(dateIso)}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[12px] text-text-3">
          <span className="truncate">{subText}</span>
          {verdict && (
            <span
              className={cn(
                'inline-flex flex-shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                verdict.tone,
              )}
            >
              {verdict.label}
              {(c.issueCount ?? 0) > 0 &&
                ` · ${c.issueCount} issue${c.issueCount === 1 ? '' : 's'}`}
            </span>
          )}
          {!isManual && (
            <span className="flex-shrink-0">
              · {c.done}/{c.total} · {c.passRate}%
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
