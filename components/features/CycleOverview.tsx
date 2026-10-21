'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiTestRun, CycleOverviewData, Module, TestCycle } from '@/types';
import { api } from '@/lib/client';
import { DonutChart } from './Dashboard';
import { UpdateQuickLogModal } from './QuickLogModal';
import { cn, initials, localDateStr, relativeTime } from '@/lib/utils';
import { JiraTicketLink, useJiraSiteUrl } from '@/lib/jiraLink';
import { SIco } from '@/components/layout/sts-icons';
import { avatarGradient, caseCode } from './tc-helpers';
import './sts-v3.css';

interface CycleOverviewProps {
  data: CycleOverviewData | null;
  loading: boolean;
  modules: Module[];
  projectId: string | null;
  projectName?: string;
  onBack: () => void;
  onOpenTestRun: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const shortDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Screen 08 — the detail page for one test run: status + dates, result stats,
// the run's row, a burn-down of cases remaining, and the recent failures.
export function CycleOverview({
  data,
  loading,
  projectId,
  projectName,
  onBack,
  onOpenTestRun,
  onUpdate,
  onDelete,
}: CycleOverviewProps) {
  const [editing, setEditing] = useState<TestCycle | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [runs, setRuns] = useState<ApiTestRun[] | null>(null);
  const siteUrl = useJiraSiteUrl(projectId);
  const cycleId = data?.cycle.id;

  // The burn-down and the failure list come from the run rows themselves.
  useEffect(() => {
    if (!cycleId) return;
    let cancelled = false;
    setRuns(null);
    api
      .get<ApiTestRun[]>(`/api/cycles/${cycleId}/runs`)
      .then(r => !cancelled && setRuns(r))
      .catch(() => !cancelled && setRuns([]));
    return () => {
      cancelled = true;
    };
  }, [cycleId]);

  const handleDelete = async () => {
    if (!data) return;
    if (!window.confirm(`Delete this test run — "${data.cycle.name}"?\n\nThis cannot be undone.`))
      return;
    setDeleting(true);
    try {
      // Nothing left to show on this screen once the cycle is gone.
      await onDelete(data.cycle.id);
      onBack();
    } catch {
      setDeleting(false);
    }
  };

  const openEdit = async () => {
    if (!data) return;
    setEditLoading(true);
    try {
      const full = await api.get<TestCycle>(`/api/cycles/${data.cycle.id}`);
      setEditing(full);
    } catch {
      // Silently ignored -- the Edit button just stays clickable to retry.
    } finally {
      setEditLoading(false);
    }
  };

  const burn = useMemo(() => {
    if (!data) return null;
    const total = data.total;
    const start = startOfDay(new Date(data.cycle.createdAt));
    const today = startOfDay(new Date());
    const dueRaw = data.cycle.targetDate ?? data.cycle.completedAt;
    let end = dueRaw ? startOfDay(new Date(dueRaw)) : today;
    if (end < today && data.cycle.status === 'Active') end = today;
    let days = Math.round((end.getTime() - start.getTime()) / DAY);
    // No due date: show a one-week window so the ideal line has a sensible slope.
    days = Math.min(Math.max(days, dueRaw ? 1 : 7), 60);
    const executed = (runs ?? [])
      .filter(r => r.executedAt)
      .map(r => new Date(r.executedAt as string).getTime());
    const lastIdx = Math.min(days, Math.round((today.getTime() - start.getTime()) / DAY));
    const pts: { d: number; remaining: number }[] = [];
    for (let d = 0; d <= Math.max(lastIdx, 0); d++) {
      const cutoff = start.getTime() + (d + 1) * DAY;
      pts.push({ d, remaining: total - executed.filter(t => t < cutoff).length });
    }
    return { total, start, end, days, pts };
  }, [data, runs]);

  if (loading || !data) {
    return <div className="stv3 state-note">Loading run…</div>;
  }

  const { cycle } = data;
  const started = localDateStr(new Date(cycle.createdAt));
  const dueIso = cycle.targetDate ?? null;
  const total = data.total;
  const pending = data.counts.NotRun;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const scopeLabel = cycle.moduleName ?? cycle.scopeName ?? 'All cases';
  const active = cycle.status === 'Active';
  const statusPill =
    cycle.status === 'Active'
      ? { cls: 'pill-brand', label: 'In progress' }
      : cycle.status === 'Archived'
        ? { cls: 'pill-neutral', label: 'Archived' }
        : { cls: 'pill-ok', label: 'Closed' };
  const failedRuns = (runs ?? [])
    .filter(r => r.result === 'Failed' || r.result === 'Blocked')
    .sort((a, b) => (b.executedAt ?? '').localeCompare(a.executedAt ?? ''));

  const X = (d: number, days: number) => 40 + (d / days) * 540;
  const Y = (v: number, t: number) => 180 - (t === 0 ? 0 : (v / t) * 160);

  return (
    <div className="stv3 main-scroll">
      <div className="breadcrumb">
        <span className="crumb">{projectName || 'Project'}</span>
        <span className="sep">/</span>
        <button type="button" className="crumb" onClick={onBack}>
          Test runs
        </button>
        <span className="sep">/</span>
        <span className="current">{cycle.name}</span>
      </div>

      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 6,
              flexWrap: 'wrap',
            }}
          >
            <span className={cn('pill', statusPill.cls)}>
              <span className="dot" /> {statusPill.label}
            </span>
            <span className="pill pill-neutral">Run</span>
            {cycle.version && (
              <span className="pill pill-neutral">v{cycle.version.replace(/^v\s*/i, '')}</span>
            )}
            {cycle.cycleCategory && (
              <span className="pill pill-neutral">{cycle.cycleCategory}</span>
            )}
            {cycle.ticketLink && (
              <span className="pill pill-neutral">
                <JiraTicketLink
                  ticketLink={cycle.ticketLink}
                  siteUrl={cycle.jiraSiteUrl ?? siteUrl}
                />
              </span>
            )}
            <span style={{ fontSize: 12, color: 'var(--t-3)' }}>
              Started {started}
              {dueIso ? ` · Due ${localDateStr(new Date(dueIso))}` : ''}
            </span>
          </div>
          <h1 className="page-title compact">{cycle.name}</h1>
          <div className="page-sub">
            Scope <b style={{ color: 'var(--t-2)' }}>{scopeLabel}</b>
            {data.tester && (
              <>
                {' '}
                · Tester <b style={{ color: 'var(--t-2)' }}>{data.tester}</b>
              </>
            )}{' '}
            · {total.toLocaleString()} cases
            {[cycle.environment, cycle.platform].filter(Boolean).length > 0 &&
              ` · ${[cycle.environment, cycle.platform].filter(Boolean).join(' · ')}`}
          </div>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={openEdit}
            disabled={editLoading}
          >
            <SIco name="edit" />
            Edit
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ color: 'var(--err)' }}
            onClick={handleDelete}
            disabled={deleting}
          >
            <SIco name="trash" />
            Delete
          </button>
          <button type="button" className="btn btn-primary" onClick={onOpenTestRun}>
            <SIco name="play" />
            {active ? (data.executed > 0 ? 'Resume execution' : 'Execute') : 'View results'}
          </button>
        </div>
      </div>

      <div className="stat-grid stat-grid-5">
        <div className="stat accent">
          <div className="stat-label">Total cases</div>
          <div className="stat-value">{total.toLocaleString()}</div>
          <div className="stat-meta">{data.executed.toLocaleString()} executed</div>
        </div>
        <div className="stat ok">
          <div className="stat-label">Passed</div>
          <div className="stat-value">{data.counts.Passed.toLocaleString()}</div>
          <div className="stat-meta">{pct(data.counts.Passed).toFixed(1)}%</div>
        </div>
        <div className="stat err">
          <div className="stat-label">Failed</div>
          <div className="stat-value">{data.failed.toLocaleString()}</div>
          <div className="stat-meta">{pct(data.failed).toFixed(1)}%</div>
        </div>
        <div className="stat warn">
          <div className="stat-label">Blocked</div>
          <div className="stat-value">{data.blocked.toLocaleString()}</div>
          <div className="stat-meta">env / dependency</div>
        </div>
        <div className="stat info">
          <div className="stat-label">Pending</div>
          <div className="stat-value">{pending.toLocaleString()}</div>
          <div className="stat-meta">{pct(pending).toFixed(1)}% remaining</div>
        </div>
      </div>

      <div className="split-rail split-rail-320">
        <div style={{ minWidth: 0 }}>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h3>
                <SIco name="play" /> Run summary
              </h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenTestRun}>
                <SIco name="play" /> Open runner
              </button>
            </div>
            <table className="t">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Progress</th>
                  <th>Pass rate</th>
                  <th>Last result</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <div className="row-title">{cycle.name}</div>
                    <div className="id-mono">
                      {scopeLabel} · {total.toLocaleString()} cases
                    </div>
                  </td>
                  <td>
                    <span className={cn('pill', active ? 'pill-info' : statusPill.cls)}>
                      <span className="dot" /> {active ? 'Running' : statusPill.label}
                    </span>
                  </td>
                  <td>
                    {data.tester ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div
                          className="avatar sm"
                          style={{ background: avatarGradient(data.tester) }}
                        >
                          {initials(data.tester)}
                        </div>
                        {data.tester.split(/\s+/)[0]}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--t-4)' }}>Unassigned</span>
                    )}
                  </td>
                  <td>
                    <div className="progress" style={{ width: 140 }}>
                      <div className="progress-stacked">
                        <span
                          style={{ width: `${pct(data.counts.Passed)}%`, background: 'var(--ok)' }}
                        />
                        <span style={{ width: `${pct(data.failed)}%`, background: 'var(--err)' }} />
                        <span
                          style={{ width: `${pct(data.blocked)}%`, background: 'var(--warn)' }}
                        />
                        <span
                          style={{
                            width: `${pct(data.counts.Skipped)}%`,
                            background: 'var(--info)',
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 3 }}>
                      {data.executed.toLocaleString()} / {total.toLocaleString()}
                    </div>
                  </td>
                  <td>
                    <span
                      style={{
                        fontWeight: 600,
                        color:
                          data.executed === 0
                            ? 'var(--t-4)'
                            : data.passRate >= 85
                              ? 'var(--ok)'
                              : data.passRate >= 60
                                ? 'var(--warn)'
                                : 'var(--err)',
                      }}
                    >
                      {data.executed === 0 ? '—' : `${data.passRate}%`}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--t-3)' }}>
                    {(runs ?? []).some(r => r.executedAt)
                      ? relativeTime(
                          (runs ?? [])
                            .filter(r => r.executedAt)
                            .sort((a, b) =>
                              (b.executedAt as string).localeCompare(a.executedAt as string),
                            )[0].executedAt as string,
                        )
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card chart-card" style={{ marginBottom: 16 }}>
            <div className="chart-head">
              <div>
                <h4>Burn-down · cases remaining</h4>
                <p>
                  Started {burn ? shortDate(burn.start) : started}
                  {dueIso && burn ? ` · Due ${shortDate(burn.end)}` : ''}
                  {` · ${pending.toLocaleString()} of ${total.toLocaleString()} left`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: 'var(--t-2)',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 14,
                      height: 2,
                      background: 'var(--neutral)',
                    }}
                  />
                  Ideal
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: 'var(--t-2)',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 14,
                      height: 2,
                      background: 'var(--brand-700)',
                    }}
                  />
                  Actual
                </span>
              </div>
            </div>
            {burn && (
              <svg className="chart-svg" viewBox="0 0 600 200" preserveAspectRatio="none">
                <line x1="40" y1="20" x2="40" y2="180" stroke="var(--bdr)" />
                <line x1="40" y1="180" x2="580" y2="180" stroke="var(--bdr)" />
                <line
                  x1="40"
                  y1="20"
                  x2="580"
                  y2="180"
                  stroke="var(--neutral)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
                <polyline
                  points={burn.pts
                    .map(p => `${X(p.d, burn.days)},${Y(p.remaining, burn.total)}`)
                    .join(' ')}
                  fill="none"
                  stroke="var(--brand-700)"
                  strokeWidth="2.5"
                />
                {burn.pts.map((p, i) => (
                  <circle
                    key={p.d}
                    cx={X(p.d, burn.days)}
                    cy={Y(p.remaining, burn.total)}
                    r={i === burn.pts.length - 1 ? 5 : 4}
                    fill="var(--brand-700)"
                  />
                ))}
                {Array.from(
                  new Set([0, 0.25, 0.5, 0.75, 1].map(f => Math.round(burn.days * f))),
                ).map(offset => {
                  const f = offset / burn.days;
                  const day = new Date(burn.start.getTime() + offset * DAY);
                  return (
                    <text
                      key={offset}
                      x={40 + f * 540}
                      y="195"
                      textAnchor={f === 1 ? 'end' : f === 0 ? 'start' : 'middle'}
                      fontSize="10"
                      fill="var(--t-4)"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {shortDate(day)}
                    </text>
                  );
                })}
                <text
                  x="30"
                  y="25"
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--t-4)"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {burn.total.toLocaleString()}
                </text>
                <text
                  x="30"
                  y="105"
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--t-4)"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {Math.round(burn.total / 2).toLocaleString()}
                </text>
                <text
                  x="30"
                  y="185"
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--t-4)"
                  fontFamily="JetBrains Mono, monospace"
                >
                  0
                </text>
              </svg>
            )}
          </div>

          <div
            className="two-up"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}
          >
            <div className="card">
              <div className="card-head">
                <h3>
                  <SIco name="pass" /> Result split
                </h3>
              </div>
              <div
                className="card-pad"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}
              >
                <DonutChart
                  pass={Math.round(pct(data.counts.Passed))}
                  fail={Math.round(pct(data.counts.Failed))}
                  block={Math.round(pct(data.counts.Blocked))}
                  value={`${data.percent}%`}
                  sublabel="executed"
                />
                <div className="run-legend" style={{ justifyContent: 'center' }}>
                  <span>
                    <i style={{ background: 'var(--ok)' }} />
                    Passed {data.counts.Passed}
                  </span>
                  <span>
                    <i style={{ background: 'var(--err)' }} />
                    Failed {data.counts.Failed}
                  </span>
                  <span>
                    <i style={{ background: 'var(--warn)' }} />
                    Blocked {data.counts.Blocked}
                  </span>
                  <span>
                    <i style={{ background: 'var(--bg-2)' }} />
                    Not run {data.counts.NotRun}
                  </span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>
                  <SIco name="chart" /> Stability
                </h3>
              </div>
              <div className="card-pad">
                {data.stability ? (
                  <>
                    <div style={{ fontSize: 11.5, color: 'var(--t-3)' }}>
                      {data.stability.moduleName}
                    </div>
                    <div
                      style={{
                        fontSize: 28,
                        fontWeight: 700,
                        letterSpacing: '-0.025em',
                        margin: '4px 0 8px',
                        color:
                          data.stability.label === 'Stable'
                            ? 'var(--ok)'
                            : data.stability.label === 'At Risk'
                              ? 'var(--warn)'
                              : data.stability.label === 'Unstable'
                                ? 'var(--err)'
                                : 'var(--t-3)',
                      }}
                    >
                      {data.stability.total === 0 ? '—' : `${data.stability.passRate}%`}
                    </div>
                    <span
                      className={cn(
                        'pill',
                        data.stability.label === 'Stable'
                          ? 'pill-ok'
                          : data.stability.label === 'At Risk'
                            ? 'pill-warn'
                            : data.stability.label === 'Unstable'
                              ? 'pill-err'
                              : 'pill-neutral',
                      )}
                    >
                      {data.stability.label}
                    </span>
                    <p
                      style={{
                        fontSize: 11.5,
                        color: 'var(--t-3)',
                        margin: '10px 0 0',
                        lineHeight: 1.5,
                      }}
                    >
                      Rolling pass rate across all {data.stability.total} run
                      {data.stability.total === 1 ? '' : 's'} + quick logs for this module.
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: 12.5, color: 'var(--t-3)', margin: 0, lineHeight: 1.5 }}>
                    This run spans more than one module, so there is no single module to score.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>
                <SIco name="fail" /> Recurring issues in this run
              </h3>
              <span className="meta">Failed here and also failed or blocked in an earlier run</span>
            </div>
            {data.recurringIssues.items.length === 0 ? (
              <div className="empty-note">
                No recurring failures — nothing here has failed before.
              </div>
            ) : (
              <div>
                {data.recurringIssues.items.map((i, idx) => (
                  <div
                    key={i.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '11px 20px',
                      borderBottom:
                        idx < data.recurringIssues.items.length - 1
                          ? '1px solid var(--bdr)'
                          : 'none',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--t-4)' }}
                        >
                          {caseCode(i.caseNum)}
                        </span>
                        <span
                          className={cn(
                            'pill',
                            i.severity === 'Critical'
                              ? 'pill-err'
                              : i.severity === 'Major'
                                ? 'pill-warn'
                                : 'pill-neutral',
                          )}
                          style={{ padding: '1px 6px', fontSize: 10 }}
                        >
                          {i.severity}
                        </span>
                      </div>
                      <div
                        style={{ fontSize: 13, fontWeight: 500, color: 'var(--t-1)', marginTop: 2 }}
                      >
                        {i.title}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--t-3)' }}>{i.scopeName}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--err)' }}>
                        {i.cycleCount}× runs
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--t-4)' }}>
                        {relativeTime(i.lastSeen)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rail">
          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, var(--brand-50), var(--brand-100))',
              borderColor: 'var(--brand-bdr)',
            }}
          >
            <div
              className="card-pad"
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--r)',
                  background: 'var(--c-surface)',
                  border: '1px solid var(--brand-bdr)',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                  color: 'var(--brand-700)',
                }}
              >
                <SIco name="info" size={14} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--brand-800)',
                    marginBottom: 4,
                  }}
                >
                  How runs work
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--t-2)', lineHeight: 1.5 }}>
                  A run holds a fixed list of cases. Open the runner to give each one a result — the
                  numbers here update as you go, and the run closes once every case has a verdict.
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Failures &amp; blockers</h3>
              <span className="meta">{failedRuns.length} in this run</span>
            </div>
            <div style={{ padding: 6 }}>
              {runs === null ? (
                <div className="empty-note" style={{ padding: '24px 12px' }}>
                  Loading…
                </div>
              ) : failedRuns.length === 0 ? (
                <div className="empty-note" style={{ padding: '24px 12px' }}>
                  Nothing failed or blocked so far.
                </div>
              ) : (
                failedRuns.slice(0, 3).map((r, i, arr) => (
                  <div
                    key={r.id}
                    style={{
                      padding: '10px 12px',
                      borderBottom: i < arr.length - 1 ? '1px solid var(--bdr)' : 'none',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 3,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--f-mono)',
                          fontSize: 11,
                          color: 'var(--err)',
                          fontWeight: 600,
                        }}
                      >
                        {caseCode(r.testCase.caseNum)}
                      </span>
                      <span>
                        <span
                          className={cn(
                            'sev-dot',
                            r.testCase.severity === 'Critical'
                              ? 'sev-critical'
                              : r.testCase.severity === 'Major'
                                ? 'sev-major'
                                : 'sev-minor',
                          )}
                        />
                        <span style={{ fontSize: 11, color: 'var(--t-3)' }}>
                          {r.testCase.severity} · {r.result}
                        </span>
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--t-1)', fontWeight: 500 }}>
                      {r.testCase.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2 }}>
                      {r.executedBy ? `${r.executedBy} · ` : ''}
                      {r.executedAt ? relativeTime(r.executedAt) : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
            {failedRuns.length > 3 && (
              <div className="card-foot">
                <button
                  type="button"
                  className="btn-link"
                  style={{ fontSize: 12 }}
                  onClick={onOpenTestRun}
                >
                  All {failedRuns.length} →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <UpdateQuickLogModal
          log={editing}
          projectId={projectId}
          onClose={() => setEditing(null)}
          onSave={async patch => {
            await onUpdate(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
