'use client';

import { useState } from 'react';
import { CycleOverviewData, Module, TestCycle } from '@/types';
import { api } from '@/lib/client';
import { DonutChart } from './Dashboard';
import { NewCycleModal } from './NewCycleModal';
import { avatarColour, cn, initials, localDateStr, relativeTime } from '@/lib/utils';

interface CycleOverviewProps {
  data: CycleOverviewData | null;
  loading: boolean;
  modules: Module[];
  projectId: string | null;
  onBack: () => void;
  onOpenTestRun: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
}

// The screen a case-based cycle opens to first -- a KPI summary, who mostly
// ran it, and any related quick logs -- before committing to the full
// case-by-case run screen (reached via "Open Test Run").
export function CycleOverview({
  data,
  loading,
  modules,
  projectId,
  onBack,
  onOpenTestRun,
  onUpdate,
}: CycleOverviewProps) {
  const [editing, setEditing] = useState<TestCycle | null>(null);
  const [editLoading, setEditLoading] = useState(false);

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

  if (loading || !data) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg text-[13px] text-text-3">
        <i className="ti ti-loader-2 mr-2 animate-spin text-[16px]" />
        Loading cycle…
      </div>
    );
  }

  const { cycle } = data;
  const statusTone =
    cycle.status === 'Active'
      ? { dot: 'bg-primary', text: 'text-primary-text', label: 'In Progress' }
      : cycle.status === 'Archived'
        ? { dot: 'bg-text-3', text: 'text-text-3', label: 'Archived' }
        : { dot: 'bg-success', text: 'text-success', label: 'Completed' };

  const start = localDateStr(new Date(cycle.createdAt));
  const endIso = cycle.completedAt ?? cycle.targetDate;
  const end = endIso ? localDateStr(new Date(endIso)) : '—';

  const scopeLabel = cycle.moduleName ?? cycle.scopeName;
  const subtitleParts = [
    scopeLabel ? `Scope: ${scopeLabel}` : null,
    cycle.environment,
    cycle.platform,
  ].filter(Boolean);

  const total = data.total;
  const pctOf = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-44 py-6">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 flex items-center gap-1.5 text-[12px] text-text-3 transition-colors hover:text-text"
        >
          <i className="ti ti-arrow-left text-[13px]" />
          Test Cycles
        </button>

        {/* Header */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium',
                  statusTone.text,
                )}
              >
                <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', statusTone.dot)} />
                {statusTone.label}
              </span>
              {cycle.cycleCategory && (
                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-text-2">
                  {cycle.cycleCategory}
                </span>
              )}
              {cycle.version && (
                <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-text-2">
                  v{cycle.version.replace(/^v\s*/i, '')}
                </span>
              )}
              {cycle.ticketLink && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-text-2">
                  <i className="ti ti-brand-jira text-[12px] text-text-3" />
                  {cycle.ticketLink.replace(/^https?:\/\//, '')}
                </span>
              )}
            </div>
            <h1 className="truncate text-[22px] font-semibold tracking-[-0.01em] text-text">
              {cycle.name}
            </h1>
            <p className="mt-1 text-[12.5px] text-text-3">
              {subtitleParts.join(' · ')}
              {subtitleParts.length > 0 && ' · '}
              {start} → {end}
            </p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={openEdit}
              disabled={editLoading}
              title="Edit cycle"
              aria-label="Edit cycle"
              className="flex h-[37px] w-[37px] items-center justify-center rounded-[7px] border border-border bg-surface text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i
                className={cn(
                  'ti',
                  editLoading ? 'ti-loader-2 animate-spin' : 'ti-pencil',
                  'text-[15px]',
                )}
              />
            </button>
            <button
              type="button"
              onClick={onOpenTestRun}
              className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-4 py-2 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover"
            >
              <i className="ti ti-player-play text-[15px]" />
              Open Test Run
            </button>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-1.5 flex items-center justify-between text-[12px] text-text-3">
          <span>
            <span className="font-semibold text-text">
              {data.executed} / {data.total}
            </span>{' '}
            executed
          </span>
          <span>
            {data.percent}% · pass rate{' '}
            <span className="font-semibold text-success">{data.passRate}%</span>
          </span>
        </div>
        <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-primary" style={{ width: `${data.percent}%` }} />
        </div>

        {/* Lifecycle */}
        <div className="mb-5 rounded-lg border border-border bg-surface px-6 py-4">
          <LifecycleTimeline cycle={cycle} />
        </div>

        {/* KPI cards */}
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Total Cases" value={data.total} />
          <KpiCard label="Executed" value={data.executed} meta={`${data.percent}% execution`} />
          <KpiCard label="Pass Rate" value={`${data.passRate}%`} tone="success" />
          <KpiCard label="Failed" value={data.failed} tone="danger" />
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Blocked" value={data.blocked} tone="warning" />
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="mb-2 text-[11px] text-text-3">Tester</p>
            {data.tester ? (
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    avatarColour(data.tester),
                  )}
                >
                  {initials(data.tester)}
                </span>
                <span className="truncate text-[14px] font-semibold text-text">{data.tester}</span>
              </span>
            ) : (
              <span className="text-[14px] text-text-3">Unattributed</span>
            )}
          </div>
        </div>

        {/* Two-column body */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex-1 rounded-lg border border-border bg-surface p-4 lg:max-w-[380px]">
            <p className="mb-4 text-[13px] font-semibold text-text">Result Split</p>
            <div className="flex flex-col items-center gap-4">
              <DonutChart
                pass={pctOf(data.counts.Passed)}
                fail={pctOf(data.counts.Failed)}
                block={pctOf(data.counts.Blocked)}
                value={`${data.percent}%`}
                sublabel="executed"
              />
              <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                <LegendDot color="#16A34A" label="Passed" value={data.counts.Passed} />
                <LegendDot color="#DC2626" label="Failed" value={data.counts.Failed} />
                <LegendDot color="#D97706" label="Blocked" value={data.counts.Blocked} />
                <LegendDot color="#A8A29E" label="Not Run" value={data.counts.NotRun} />
              </div>
            </div>
          </div>

          <div className="flex-1 rounded-lg border border-border bg-surface p-4">
            <p className="mb-4 text-[13px] font-semibold text-text">Stability</p>
            {data.stability ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-text-3">{data.stability.moduleName}</p>
                    <p
                      className={cn(
                        'text-[26px] font-bold tabular-nums',
                        data.stability.label === 'Stable'
                          ? 'text-success'
                          : data.stability.label === 'At Risk'
                            ? 'text-warning'
                            : data.stability.label === 'Unstable'
                              ? 'text-danger'
                              : 'text-text-3',
                      )}
                    >
                      {data.stability.total === 0 ? '—' : `${data.stability.passRate}%`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium',
                      data.stability.label === 'Stable'
                        ? 'bg-success-bg text-success-text'
                        : data.stability.label === 'At Risk'
                          ? 'bg-warning-bg text-warning-text'
                          : data.stability.label === 'Unstable'
                            ? 'bg-danger-bg text-danger-text'
                            : 'bg-surface-3 text-text-3',
                    )}
                  >
                    <i
                      className={cn(
                        'ti text-[13px]',
                        data.stability.trend === 'up'
                          ? 'ti-trending-up'
                          : data.stability.trend === 'down'
                            ? 'ti-trending-down'
                            : 'ti-minus',
                      )}
                    />
                    {data.stability.label}
                  </span>
                </div>
                <p className="text-[11px] text-text-3">
                  Rolling pass rate across all {data.stability.total} run
                  {data.stability.total === 1 ? '' : 's'} + quick logs for this module — not just
                  this cycle.
                </p>
              </div>
            ) : (
              <p className="text-[12.5px] text-text-3">
                This cycle spans more than one module, so there is no single module to score.
              </p>
            )}
          </div>
        </div>

        {/* Recurring issues — full width, below the KPI/donut/stability row */}
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <p className="mb-1 text-[13px] font-semibold text-text">Recurring Issues in this Cycle</p>
          <p className="mb-3 text-[11px] text-text-3">
            Cases that failed here and have also failed or been blocked in an earlier cycle.
          </p>
          {data.recurringIssues.items.length === 0 ? (
            <p className="text-[12.5px] text-text-3">
              No recurring failures — nothing here has failed before.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {data.recurringIssues.items.map(i => (
                <div
                  key={i.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-text-3">
                        TC-{String(i.caseNum).padStart(2, '0')}
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
                    <div className="text-[12.5px] font-semibold text-danger">
                      {i.cycleCount}× cycles
                    </div>
                    <div className="text-[10.5px] text-text-3">{relativeTime(i.lastSeen)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <NewCycleModal
          modules={modules}
          projectId={projectId}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async input => {
            const patch: Record<string, unknown> = { ...input };
            await onUpdate(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// Planned always happened (the cycle exists); "In Progress" shares that
// same created date since nothing tracks a separate "started" moment;
// Completed only lights up once the cycle actually has a completedAt (or
// has moved to a terminal status), showing "—" until then.
function LifecycleTimeline({ cycle }: { cycle: CycleOverviewData['cycle'] }) {
  const isDone = cycle.status === 'Completed' || cycle.status === 'Archived';
  const plannedDate = localDateStr(new Date(cycle.createdAt));
  const completedDate = cycle.completedAt ? localDateStr(new Date(cycle.completedAt)) : '—';

  const Stage = ({
    label,
    date,
    state,
  }: {
    label: string;
    date: string;
    state: 'done' | 'current' | 'pending';
  }) => (
    <div className="flex flex-col items-center gap-1">
      <span
        className={cn(
          'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 text-[13px]',
          state === 'done'
            ? 'border-success bg-success-bg text-success'
            : state === 'current'
              ? 'border-warning bg-warning-bg text-warning'
              : 'border-border bg-surface text-text-3',
        )}
      >
        <i
          className={cn(
            'ti',
            state === 'done' ? 'ti-check' : state === 'current' ? 'ti-clock' : 'ti-circle',
          )}
        />
      </span>
      <span className="text-[11px] font-medium text-text">{label}</span>
      <span className="text-[10px] text-text-3">{date}</span>
    </div>
  );

  return (
    <div className="flex items-center">
      <Stage label="Planned" date={plannedDate} state="done" />
      <div className="mb-4 h-[2px] flex-1 bg-success" />
      <Stage label="In Progress" date={plannedDate} state={isDone ? 'done' : 'current'} />
      <div className={cn('mb-4 h-[2px] flex-1', isDone ? 'bg-success' : 'bg-border')} />
      <Stage label="Completed" date={completedDate} state={isDone ? 'done' : 'pending'} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: number | string;
  meta?: string;
  tone?: 'success' | 'danger' | 'warning';
}) {
  const toneCls =
    tone === 'success'
      ? 'text-success'
      : tone === 'danger'
        ? 'text-danger'
        : tone === 'warning'
          ? 'text-warning'
          : 'text-text';
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-[11px] text-text-3">{label}</p>
      <p className={cn('mt-1 text-[22px] font-bold tabular-nums', toneCls)}>{value}</p>
      {meta && <p className="mt-0.5 text-[11px] text-text-3">{meta}</p>}
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5 text-text-2">
      <span
        className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
        style={{ background: color }}
      />
      {label}
      <span className="ml-auto font-mono tabular-nums text-text">{value}</span>
    </span>
  );
}
