'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { ActivityEvent } from '@/lib/activity';
import { cn, initials, relativeTime } from '@/lib/utils';
import { avatarGradient } from '@/components/features/tc-helpers';
import { SIco } from '@/components/layout/sts-icons';
import './sts-v3.css';

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
  onShowProjects?: () => void;
  projectId: string | null;
  projectName?: string;
  userName?: string | null;
}

export function Dashboard({
  onShowTestRuns,
  onOpenCycle,
  onShowReports,
  onShowStabilityReport,
  onShowProjects,
  projectId,
  projectName,
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
    return <div className="stv3 state-note">Loading overview…</div>;
  }
  if (error || !data) {
    return (
      <div className="stv3 state-note" style={{ color: 'var(--err)' }}>
        {error || 'Failed to load'}
      </div>
    );
  }

  const activeRunsCount = data.recentCycles.filter(c => c.status === 'Active').length;
  // Most-recent Active cycle, if any — recentCycles is already newest-first.
  // Quick logs are never Active (they're Completed the instant they're
  // logged), so this only ever surfaces a CaseBased run.
  const activeCycle = data.recentCycles.find(c => c.status === 'Active') ?? null;

  const verdicts = data.passed30d.total + data.failed30d.total + data.blocked30d.total;
  const rate = (n: number) => (verdicts > 0 ? ((n / verdicts) * 100).toFixed(1) : '0.0');

  return (
    <div className="stv3 main-scroll">
      <div className="breadcrumb">
        <button type="button" className="crumb btn-link" onClick={onShowProjects}>
          Projects
        </button>
        <span className="sep">/</span>
        <span className="crumb">{projectName || 'Project'}</span>
        <span className="sep">/</span>
        <span className="current">Overview</span>
      </div>

      <GreetingBanner
        userName={userName}
        activeCount={activeRunsCount}
        openFailures={data.openFailures.total}
        critical={data.criticalIssues}
        onShowTestRuns={onShowTestRuns}
      />

      <div className="stat-grid">
        <Stat
          tone="ok"
          icon="pass"
          label="Passed · 30d"
          value={data.passed30d.total}
          trend={data.passed30d.pctChange}
          note={`${rate(data.passed30d.total)}% rate`}
        />
        <Stat
          tone="err"
          icon="fail"
          label="Failed · 30d"
          value={data.failed30d.total}
          trend={data.failed30d.pctChange}
          note={`${rate(data.failed30d.total)}% rate`}
        />
        <Stat
          tone="warn"
          icon="lock"
          label="Blocked · 30d"
          value={data.blocked30d.total}
          trend={data.blocked30d.pctChange}
          note={`${rate(data.blocked30d.total)}% rate`}
        />
        <Stat
          tone="accent"
          icon="file"
          label="Test cases"
          value={data.totalCases}
          note={`${data.runs30d.total.toLocaleString()} executions in 30d`}
        />
      </div>

      <div className="grid-2">
        <div style={{ minWidth: 0 }}>
          {activeCycle && (
            <ActiveRunCard cycle={activeCycle} onOpen={onOpenCycle} onShowAll={onShowTestRuns} />
          )}

          <Card
            icon="clock"
            title="Recent test runs"
            action={
              <button
                type="button"
                className="btn-link"
                style={{ fontSize: 12 }}
                onClick={onShowTestRuns}
              >
                View all test runs →
              </button>
            }
          >
            {data.recentCycles.length === 0 ? (
              <div className="empty-note">
                Nothing yet.{' '}
                <button type="button" className="btn-link" onClick={onShowTestRuns}>
                  Create a test run
                </button>{' '}
                to get started.
              </div>
            ) : (
              <RecentRunsTable cycles={data.recentCycles.slice(0, 4)} onOpen={onOpenCycle} />
            )}
          </Card>

          <Card
            icon="chart"
            title="Execution trend"
            meta="Last 8 weeks — executed, passed, failed and blocked"
            pad
          >
            <TrendChart weekly={data.weeklyRuns} />
          </Card>

          <ResultDistributionCard data={data} />

          <Card
            icon="overview"
            title="Coverage by module"
            meta="Worst-covered first"
            action={
              onShowStabilityReport && (
                <button
                  type="button"
                  className="btn-link"
                  style={{ fontSize: 12 }}
                  onClick={onShowStabilityReport}
                >
                  Full stability report →
                </button>
              )
            }
            pad
          >
            {data.moduleStability.length === 0 ? (
              <p className="text-[12.5px] text-text-3">No module activity yet.</p>
            ) : (
              <CoverageTable modules={data.moduleStability} limit={5} />
            )}
          </Card>

          <Card
            icon="fail"
            title="Recurring issues"
            meta="Failed in 2+ separate test runs"
            action={
              onShowReports && (
                <button
                  type="button"
                  className="btn-link"
                  style={{ fontSize: 12 }}
                  onClick={onShowReports}
                >
                  Full report →
                </button>
              )
            }
            pad
          >
            {data.recurringIssues.items.length === 0 ? (
              <p className="text-[12.5px] text-text-3">No recurring issues right now.</p>
            ) : (
              <RecurringIssuesList items={data.recurringIssues.items} />
            )}
          </Card>
        </div>

        <div className="rail" style={{ minWidth: 0 }}>
          <CalendarCard cycles={data.recentCycles} />
          <ActivityCard events={data.recentActivity} onShowReports={onShowReports} />
        </div>
      </div>
    </div>
  );
}

// ─── building blocks ─────────────────────────────────────

function Card({
  icon,
  title,
  meta,
  action,
  pad,
  children,
}: {
  icon: Parameters<typeof SIco>[0]['name'];
  title: string;
  meta?: string;
  action?: React.ReactNode;
  pad?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <h3>
          <SIco name={icon} /> {title}
        </h3>
        {action ?? (meta ? <span className="meta">{meta}</span> : null)}
      </div>
      {pad ? <div className="card-pad">{children}</div> : children}
    </div>
  );
}

function Stat({
  tone,
  icon,
  label,
  value,
  trend,
  note,
}: {
  tone: 'ok' | 'err' | 'warn' | 'info' | 'accent';
  icon: Parameters<typeof SIco>[0]['name'];
  label: string;
  value: number;
  // Signed % change vs. the prior period. Sign alone picks the arrow and
  // colour, same as the mockup (a falling Failed count still reads "down").
  trend?: number;
  note: string;
}) {
  return (
    <div className={cn('stat', tone)}>
      <div className="stat-label">
        <SIco name={icon} /> {label}
      </div>
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-meta">
        {trend !== undefined && (
          <span className={cn('stat-trend', trend >= 0 ? 'up' : 'down')}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%
          </span>
        )}
        {trend !== undefined ? `vs prev 30d · ${note}` : note}
      </div>
    </div>
  );
}

function GreetingBanner({
  userName,
  activeCount,
  openFailures,
  critical,
  onShowTestRuns,
}: {
  userName?: string | null;
  activeCount: number;
  openFailures: number;
  critical: number;
  onShowTestRuns: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const first = userName?.trim().split(/\s+/)[0];
  return (
    <div className="greet-banner">
      <div style={{ flex: 1 }}>
        <div className="greet-text">
          Hey{first ? ', ' : ''}
          {first && <span style={{ color: 'var(--brand-700)' }}>{first}</span>}{' '}
          <span className="wave">👋</span>
        </div>
        <div className="greet-sub">
          You have{' '}
          <b>
            {activeCount} active test run{activeCount === 1 ? '' : 's'}
          </b>{' '}
          and{' '}
          <b>
            {openFailures} open failure{openFailures === 1 ? '' : 's'}
          </b>
          {critical > 0 && <> ({critical} critical)</>}.{' '}
          <button type="button" onClick={onShowTestRuns}>
            View test runs →
          </button>
        </div>
      </div>
      <button
        type="button"
        className="greet-close"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <SIco name="x" />
      </button>
    </div>
  );
}

function ActiveRunCard({
  cycle,
  onOpen,
  onShowAll,
}: {
  cycle: RecentCycle;
  onOpen?: (id: string) => void;
  onShowAll: () => void;
}) {
  const c = cycle.counts;
  const total = Math.max(cycle.total, 1);
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  const legend = [
    { label: 'Passed', n: c.Passed, color: 'var(--ok)' },
    { label: 'Failed', n: c.Failed, color: 'var(--err)' },
    { label: 'Blocked', n: c.Blocked, color: 'var(--warn)' },
    { label: 'Skipped', n: c.Skipped, color: 'var(--info)' },
    { label: 'Pending', n: c.NotRun, color: 'var(--bg-2)' },
  ];
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <h3>
          <SIco name="play" /> Active test run
        </h3>
        <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={onShowAll}>
          All test runs →
        </button>
      </div>
      <div className="card-pad" style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span className="pill pill-brand">
              <span className="dot" /> In progress
            </span>
            <span style={{ fontSize: 12, color: 'var(--t-3)' }}>
              Started {relativeTime(cycle.createdAt)}
            </span>
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--t-1)',
              letterSpacing: '-0.015em',
              marginBottom: 6,
            }}
          >
            {cycle.name}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--t-3)', marginBottom: 14 }}>
            Scope:{' '}
            <b style={{ color: 'var(--t-2)', fontWeight: 600 }}>
              {cycle.scopeName ?? (cycle.scopeType === 'All' ? 'All cases' : cycle.scopeType)}
            </b>{' '}
            · {cycle.total} cases · {cycle.done} executed
          </div>
          <div className="progress-stacked" style={{ marginBottom: 8 }}>
            <span style={{ width: pct(c.Passed), background: 'var(--ok)' }} />
            <span style={{ width: pct(c.Failed), background: 'var(--err)' }} />
            <span style={{ width: pct(c.Blocked), background: 'var(--warn)' }} />
            <span style={{ width: pct(c.Skipped), background: 'var(--info)' }} />
          </div>
          <div className="run-legend">
            {legend.map(l => (
              <span key={l.label}>
                <i style={{ background: l.color }} />
                {l.label} {l.n}
              </span>
            ))}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            paddingLeft: 18,
            borderLeft: '1px dashed var(--bdr)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: 'var(--t-4)',
              textTransform: 'uppercase',
              letterSpacing: '.05em',
              fontWeight: 600,
            }}
          >
            Pass rate
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: 'var(--ok)',
              letterSpacing: '-0.03em',
              lineHeight: 1,
            }}
          >
            {cycle.passRate}%
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--t-3)' }}>on executed</div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ marginTop: 6 }}
            onClick={() => onOpen?.(cycle.id)}
          >
            <SIco name="play" /> Continue
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Recent runs table ───────────────────────────────────

function RecentRunsTable({
  cycles,
  onOpen,
}: {
  cycles: RecentCycle[];
  onOpen?: (id: string) => void;
}) {
  return (
    <table className="t">
      <thead>
        <tr>
          <th>Run</th>
          <th>Status</th>
          <th>Progress</th>
          <th>Pass</th>
          <th>Tester</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {cycles.map(c => (
          <RecentRunRow key={c.id} cycle={c} onOpen={onOpen} />
        ))}
      </tbody>
    </table>
  );
}

function RecentRunRow({ cycle: c, onOpen }: { cycle: RecentCycle; onOpen?: (id: string) => void }) {
  const isManual = c.mode === 'Manual';
  // Quick-log entries don't have per-case runs — express the outcome as a
  // single Pass/Fail from the verdict counts the API already computed.
  // A case-based run gets the same once it's no longer Active; still-Active
  // runs have no verdict yet.
  const verdict = isManual
    ? c.counts.Passed > 0
      ? 'Pass'
      : 'Fail'
    : c.status !== 'Active'
      ? c.counts.Failed + c.counts.Blocked === 0
        ? 'Pass'
        : 'Fail'
      : null;
  // Manual cycles store their scope as free text instead of an id.
  const subText = isManual
    ? [c.portalName, c.moduleName, c.featureName].filter(Boolean).join(' › ') || 'quick log'
    : c.scopeType === 'All'
      ? 'all cases'
      : (c.scopeName ?? c.scopeType);
  const dateIso = (isManual && c.completedAt) || c.createdAt;
  const isGroup = /\d+ testers$/.test(c.tester);
  const pct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;

  return (
    <tr className="click" onClick={() => onOpen?.(c.id)}>
      <td style={{ maxWidth: 240 }}>
        <div
          className="row-title"
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {c.name}
        </div>
        <div
          className="id-mono"
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {subText} · {relativeTime(dateIso)}
        </div>
      </td>
      <td>
        {c.status === 'Active' ? (
          <span className="pill pill-brand">
            <span className="dot" /> Active
          </span>
        ) : verdict === 'Pass' ? (
          <span className="pill pill-ok">
            Pass
            {(c.issueCount ?? 0) > 0 && ` · ${c.issueCount} issue${c.issueCount === 1 ? '' : 's'}`}
          </span>
        ) : (
          <span className="pill pill-err">
            Fail
            {(c.issueCount ?? 0) > 0 && ` · ${c.issueCount} issue${c.issueCount === 1 ? '' : 's'}`}
          </span>
        )}
      </td>
      <td>
        {isManual ? (
          <span style={{ fontSize: 11.5, color: 'var(--t-3)' }}>quick log</span>
        ) : (
          <>
            <div className="progress" style={{ width: 120 }}>
              <span className="progress-bar ok" style={{ width: `${pct}%` }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 3 }}>
              {c.done} / {c.total}
            </div>
          </>
        )}
      </td>
      <td
        style={{
          color: c.passRate >= 85 ? 'var(--ok)' : c.passRate >= 60 ? 'var(--warn)' : 'var(--err)',
          fontWeight: 600,
        }}
      >
        {isManual ? '—' : `${c.passRate}%`}
      </td>
      <td>
        {!c.tester ? (
          <span style={{ fontSize: 12, color: 'var(--t-4)' }}>Unattributed</span>
        ) : isGroup ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="avatar sm" style={{ background: 'var(--bg-2)', color: 'var(--t-3)' }}>
              <SIco name="users" size={11} />
            </div>
            {c.tester}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="avatar sm" style={{ background: avatarGradient(c.tester) }}>
              {initials(c.tester)}
            </div>
            {c.tester}
          </div>
        )}
      </td>
      <td>
        {c.status === 'Active' ? (
          <button type="button" className="icon-btn" aria-label="Open run">
            <SIco name="chevron-right" />
          </button>
        ) : (
          <span className="pill pill-neutral">
            {c.status === 'Completed' ? 'Closed' : c.status}
          </span>
        )}
      </td>
    </tr>
  );
}

// ─── Right rail ──────────────────────────────────────────

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function CalendarCard({ cycles }: { cycles: RecentCycle[] }) {
  const now = new Date();
  const [offset, setOffset] = useState(0);
  const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);

  // Days that have run activity (a run created or completed that day).
  const eventDays = useMemo(() => {
    const set = new Set<string>();
    for (const c of cycles) {
      for (const iso of [c.createdAt, c.completedAt]) {
        if (!iso) continue;
        const d = new Date(iso);
        set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
      }
    }
    return set;
  }, [cycles]);

  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  // Drop a trailing row that's entirely next month, like the mockup's 6 rows
  // only when needed.
  const rows = cells[35].getMonth() === view.getMonth() ? 6 : 5;

  return (
    <div className="card card-pad-sm">
      <div className="cal-head">
        <h4>Calendar</h4>
        <div className="cal-nav">
          <button
            type="button"
            className="icon-btn btn-sm"
            aria-label="Previous month"
            onClick={() => setOffset(o => o - 1)}
          >
            <SIco name="chevron-left" />
          </button>
          <span style={{ fontSize: 12, color: 'var(--t-2)', fontWeight: 500, padding: '0 6px' }}>
            {MONTHS[view.getMonth()]} {view.getFullYear()}
          </span>
          <button
            type="button"
            className="icon-btn btn-sm"
            aria-label="Next month"
            onClick={() => setOffset(o => o + 1)}
          >
            <SIco name="chevron-right" />
          </button>
        </div>
      </div>
      <div className="cal-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="cal-dow">
            {d}
          </span>
        ))}
        {cells.slice(0, rows * 7).map(d => {
          const isToday = d.toDateString() === now.toDateString();
          const dim = d.getMonth() !== view.getMonth();
          const ev = eventDays.has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
          return (
            <span
              key={d.toISOString()}
              className={cn('cal-day', dim && 'dim', isToday && 'today', ev && 'has-event')}
            >
              {d.getDate()}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ActivityCard({
  events,
  onShowReports,
}: {
  events: ActivityEvent[];
  onShowReports?: () => void;
}) {
  const [tab, setTab] = useState<'all' | 'runs'>('all');
  const list = (tab === 'runs' ? events.filter(e => e.kind === 'run') : events).slice(0, 6);
  let lastDay = '';

  return (
    <div className="card">
      <div className="card-head">
        <h3>
          <SIco name="clock" /> Activity
        </h3>
        <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
          <button
            type="button"
            className={cn('tab', tab === 'all' && 'active')}
            style={{ padding: '4px 10px', fontSize: 11.5 }}
            onClick={() => setTab('all')}
          >
            All
          </button>
          <button
            type="button"
            className={cn('tab', tab === 'runs' && 'active')}
            style={{ padding: '4px 10px', fontSize: 11.5 }}
            onClick={() => setTab('runs')}
          >
            Test changes
          </button>
        </div>
      </div>
      <div className="activity">
        {list.length === 0 ? (
          <div className="empty-note" style={{ padding: '24px 16px' }}>
            No activity yet.
          </div>
        ) : (
          list.map((e, i) => {
            const day = dayLabel(e.ts);
            const header = day !== lastDay;
            lastDay = day;
            return (
              <div key={i}>
                {header && <div className="activity-day">{day}</div>}
                <div className={cn('activity-item', e.kind === 'run' ? 'a-status' : 'a-create')}>
                  <div className="a-ico">
                    <SIco name={e.kind === 'run' ? 'pass' : 'plus'} />
                  </div>
                  <div className="a-body">
                    <div className="a-text">
                      <b>{e.actor}</b>{' '}
                      {e.kind === 'run' ? (
                        <>
                          marked <b>{e.caseLabel}</b> as{' '}
                          <b
                            style={{
                              color:
                                e.result === 'Passed'
                                  ? 'var(--ok)'
                                  : e.result === 'Failed'
                                    ? 'var(--err)'
                                    : 'var(--warn)',
                            }}
                          >
                            {e.result}
                          </b>
                        </>
                      ) : (
                        <>
                          logged a quick log against <b>{e.scopeName}</b>
                        </>
                      )}
                    </div>
                    <div className="a-meta">
                      {relativeTime(e.ts)}
                      {e.kind === 'run' ? ` · in ${e.cycleName}` : ''}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="card-foot">
        <span>
          Showing {list.length} of {events.length} events
        </span>
        {onShowReports && (
          <button
            type="button"
            className="btn-link"
            style={{ fontSize: 11.5 }}
            onClick={onShowReports}
          >
            View reports →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Charts + lists (data views from the previous dashboard) ─────

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
        <g stroke="currentColor" strokeOpacity="0.12" strokeWidth="1">
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

// Overall Passed/Failed/Blocked mix over the last 30 days -- blended
// CaseBased + quick-log counts, same 30d window and numbers shown in the stat
// cards above, just visualized as a share of the whole. Not run/skipped aren't
// a verdict, so they're left out of the denominator.
function ResultDistributionCard({ data }: { data: DashboardData }) {
  const passed = data.passed30d.total;
  const failed = data.failed30d.total;
  const blocked = data.blocked30d.total;
  const total = passed + failed + blocked;
  const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <Card icon="pass" title="Result distribution" meta="Last 30 days" pad>
      {total === 0 ? (
        <p className="text-[12.5px] text-text-3">No results in the last 30 days.</p>
      ) : (
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
      )}
    </Card>
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

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

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
                C-{String(i.caseNum).padStart(4, '0')}
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
