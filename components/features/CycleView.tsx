'use client';

import { useEffect, useMemo, useState } from 'react';
import { TestCycle, ApiTestRun, CycleSummary, RunResult, Module } from '@/types';
import { api } from '@/lib/client';
import { exportCycleResults } from '@/lib/export';
import { CycleReportModal } from './CycleReportModal';
import { UpdateQuickLogModal } from './QuickLogModal';
import {
  avatarColour,
  cn,
  initials,
  priorityDisplay,
  relativeTime,
  resultTone,
  resultToneDisplay,
  severityDisplay,
  typeDisplay,
} from '@/lib/utils';
import { colorClassesOf } from '@/lib/colors';
import { JiraTicketLink, useJiraSiteUrl } from '@/lib/jiraLink';
import type { JiraSubIssueInfo } from '@/lib/jira';

interface CycleViewProps {
  cycle: TestCycle;
  runs: ApiTestRun[];
  summary: CycleSummary | null;
  loading: boolean;
  modules: Module[];
  projectId: string | null;
  onBack: () => void;
  // `result` is a category KEY (see lib/options.ts) -- a built-in enum
  // literal or a custom RunResult WorkspaceOption.id.
  onSubmitResult: (runId: string, result: string, notes?: string) => Promise<void>;
  onCloseRun?: (cycleId: string) => void;
  onRegenerate?: (cycleId: string) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
}

const RESULT_BTN: Partial<Record<RunResult, string>> = {
  NotRun: 'border-border text-text-3 hover:bg-surface-2',
  Passed: 'border-green-300 text-green-700 hover:bg-green-50',
  Failed: 'border-red-300 text-red-700 hover:bg-red-50',
  Blocked: 'border-amber-300 text-amber-700 hover:bg-amber-50',
  Skipped: 'border-slate-300 text-slate-600 hover:bg-slate-50',
};

type FilterTab = 'All' | RunResult | 'Recurring';

interface RunResultOption {
  key: string;
  name: string;
  color: string;
}

// The workspace's Run Result options -- built-ins first, then any custom
// ones added in Settings > Test Configuration (see lib/options.ts). Drives
// the "Submit result" grid in the selected-case panel.
function useRunResultOptions(projectId: string | null): RunResultOption[] {
  const [options, setOptions] = useState<RunResultOption[]>([]);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .get<{ options: RunResultOption[] }>(`/api/projects/${projectId}/options/RunResult`)
      .then(r => !cancelled && setOptions(r.options))
      .catch(() => {
        /* leave empty -- submit grid renders nothing until options load */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return options;
}

interface RecurringItem {
  id: string;
  title: string;
  caseNum: number;
  severity: string;
  scopeName: string;
  occurrences: number;
  cycleCount: number;
  lastSeen: string;
}

// A case attaches to a portal, module, or suite directly -- this walks
// whichever's populated so grouping/display never depends on scope mode.
function caseModuleName(run: ApiTestRun): string {
  const tc = run.testCase;
  return tc.suite?.module.name ?? tc.module?.name ?? tc.portal?.name ?? 'Unscoped';
}
function caseScopePath(run: ApiTestRun): string {
  const tc = run.testCase;
  if (tc.suite) return `${tc.suite.module.name} → ${tc.suite.name}`;
  return caseModuleName(run);
}

export function CycleView({
  cycle,
  runs,
  summary,
  loading,
  modules,
  projectId,
  onBack,
  onSubmitResult,
  onCloseRun,
  onRegenerate,
  onUpdate,
}: CycleViewProps) {
  const [filter, setFilter] = useState<FilterTab>('All');
  const [moduleFilter, setModuleFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // Only a recurring-issue row expands — the chevron there opens its cross-cycle history.
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [recurring, setRecurring] = useState<RecurringItem[] | null>(null);
  // Fetched once here and threaded down to the ticket pill, the Jira sync
  // panel, and the Summary/Report modals -- one fetch per screen instead of
  // each display spot re-checking the connection itself.
  const siteUrl = useJiraSiteUrl(projectId);

  // Same "failed here and failed/blocked in 2+ distinct cycles" rule as the
  // Cycle Overview screen -- fetched from the same endpoint so the two
  // screens can't disagree about what counts as recurring.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ recurringIssues: { items: RecurringItem[] } }>(`/api/cycles/${cycle.id}/overview`)
      .then(d => {
        if (!cancelled) setRecurring(d.recurringIssues.items);
      })
      .catch(() => {
        if (!cancelled) setRecurring([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cycle.id]);

  // Default-select first failed run so the failure panel is visible on open (matches design).
  useEffect(() => {
    if (selectedRunId) return;
    if (runs.length === 0) return;
    const firstFail = runs.find(r => r.result === 'Failed');
    setSelectedRunId(firstFail?.id ?? runs[0].id);
  }, [runs, selectedRunId]);

  const recurringIds = useMemo(() => new Set((recurring ?? []).map(r => r.id)), [recurring]);

  const moduleGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        total: number;
        executed: number;
        passed: number;
        failed: number;
        blocked: number;
      }
    >();
    for (const r of runs) {
      const name = caseModuleName(r);
      if (!map.has(name))
        map.set(name, { name, total: 0, executed: 0, passed: 0, failed: 0, blocked: 0 });
      const g = map.get(name)!;
      g.total++;
      if (r.result !== 'NotRun') g.executed++;
      if (r.result === 'Passed') g.passed++;
      if (r.result === 'Failed') g.failed++;
      if (r.result === 'Blocked') g.blocked++;
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [runs]);

  const filteredRuns = useMemo(() => {
    let list = runs;
    if (moduleFilter) list = list.filter(r => caseModuleName(r) === moduleFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        r =>
          r.testCase.title.toLowerCase().includes(q) ||
          String(r.testCase.caseNum).includes(q) ||
          `tc-${r.testCase.caseNum}`.includes(q),
      );
    }
    if (filter === 'Recurring') return list.filter(r => recurringIds.has(r.testCaseId));
    if (filter === 'All') return list;
    // The 5 tabs are built-in results only -- a run with a custom result
    // (see lib/options.ts) shows under "All" but not under any specific
    // built-in tab, since it isn't one of those 5 values.
    return list.filter(r => !r.customResultId && r.result === filter);
  }, [runs, moduleFilter, search, filter, recurringIds]);

  const selectedRun = useMemo(
    () => runs.find(r => r.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  const total = summary?.total ?? runs.length;
  const counts = summary?.counts ?? { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
  const done = summary?.done ?? total - counts.NotRun;
  const percent = summary?.percent ?? (total === 0 ? 0 : Math.round((done / total) * 100));

  const statusTone =
    cycle.status === 'Completed'
      ? { label: 'Completed', dot: 'bg-success', text: 'text-success' }
      : cycle.status === 'Archived'
        ? { label: 'Archived', dot: 'bg-text-3', text: 'text-text-3' }
        : { label: 'In Progress', dot: 'bg-primary', text: 'text-primary-text' };

  const subtitleParts = [
    cycle.version ? `v${cycle.version.replace(/^v\s*/i, '')}` : null,
    cycle.environment,
    cycle.scopeName ? `Scope: ${cycle.scopeName}` : null,
  ].filter(Boolean);

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: 'All', label: 'All', count: runs.length },
    { key: 'Passed', label: 'Passed', count: counts.Passed },
    { key: 'Failed', label: 'Failed', count: counts.Failed },
    { key: 'Blocked', label: 'Blocked', count: counts.Blocked },
    { key: 'NotRun', label: 'Not Run', count: counts.NotRun },
    { key: 'Recurring', label: 'Recurring Issues', count: recurring?.length ?? 0 },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-44 py-6">
        {/* Breadcrumb */}
        <div className="mb-3 flex items-center gap-1.5 text-[12px] text-text-3">
          <button type="button" onClick={onBack} className="hover:text-text">
            Test Runs
          </button>
          <span>/</span>
          <span className="font-medium text-text">Execution</span>
        </div>

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
              {cycle.ticketLink && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-text-2">
                  <i className="ti ti-brand-jira text-[12px] text-text-3" />
                  <JiraTicketLink
                    ticketLink={cycle.ticketLink}
                    siteUrl={cycle.jiraSiteUrl ?? siteUrl}
                  />
                </span>
              )}
            </div>
            <h1 className="truncate text-[22px] font-semibold tracking-[-0.01em] text-text">
              {cycle.name}
            </h1>
            {subtitleParts.length > 0 && (
              <p className="mt-1 text-[12.5px] text-text-3">{subtitleParts.join(' · ')}</p>
            )}
          </div>

          <div className="flex flex-shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <div className="relative w-[220px]">
                <i className="ti ti-search pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-text-3" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search case ID or title…"
                  className="w-full rounded-[7px] border border-border bg-surface py-1.5 pl-8 pr-3 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                />
              </div>
              {moduleGroups.length > 1 && (
                <select
                  value={moduleFilter}
                  onChange={e => setModuleFilter(e.target.value)}
                  className="rounded-[7px] border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-primary"
                >
                  <option value="">All Modules in Scope</option>
                  {moduleGroups.map(m => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowEdit(true)}
                className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-[7px] text-[13px] text-text transition-colors hover:bg-surface-2"
                title="Edit test run"
              >
                <i className="ti ti-pencil text-[15px]" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => exportCycleResults(cycle, runs)}
                className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-[7px] text-[13px] text-text transition-colors hover:bg-surface-2"
              >
                <i className="ti ti-download text-[15px]" />
                Export
              </button>
              <button
                type="button"
                onClick={() => setShowReport(true)}
                className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-[7px] text-[13px] text-text transition-colors hover:bg-surface-2"
                title="Open the shareable summary report"
              >
                <i className="ti ti-clipboard-text text-[15px]" />
                Summary
              </button>
              {onCloseRun && cycle.status === 'Active' && counts.NotRun === 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        `Close run "${cycle.name}"? It will be marked Completed and become read-only.`,
                      )
                    ) {
                      onCloseRun(cycle.id);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-[7px] text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover"
                >
                  <i className="ti ti-flag-check text-[15px]" />
                  Close run
                </button>
              )}
            </div>
          </div>
        </div>

        {/* KPI cards */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Executed" value={done} meta={`${percent}% of ${total}`} />
          <KpiCard label="Passed" value={counts.Passed} tone="success" />
          <KpiCard label="Failed" value={counts.Failed} tone="danger" />
          <KpiCard label="Blocked" value={counts.Blocked} tone="warning" />
        </div>

        {/* Progress bar */}
        <div className="mb-4 rounded-lg border border-border bg-surface px-5 py-4">
          <div className="mb-2 flex items-center justify-between text-[13px] text-text-2">
            <span>
              <span className="font-semibold text-text">
                {done} / {total}
              </span>{' '}
              executed
            </span>
            <span className="font-semibold text-text">{percent}%</span>
          </div>
          <SegmentedProgressBar counts={counts} total={total} height={8} />
        </div>

        {cycle.ticketLink && (
          <JiraSyncPanel
            cycle={cycle}
            projectId={projectId}
            siteUrl={siteUrl}
            onUpdate={onUpdate}
          />
        )}

        {/* Module Breakdown */}
        <div className="mb-4 rounded-lg border border-border bg-surface p-4">
          <p className="text-[14px] font-semibold text-text">Module Breakdown</p>
          <p className="mb-3 text-[11.5px] text-text-3">
            {moduleGroups.length <= 1
              ? `This run is scoped to ${moduleGroups[0]?.name ?? 'one module'} — nothing else is in play`
              : 'Click a module to filter the list below to just that module'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-text-3">
                  <th className="border-b border-border pb-2 pr-3">Module</th>
                  <th className="border-b border-border pb-2 pr-3">Executed</th>
                  <th className="border-b border-border pb-2 pr-3">Pass Rate</th>
                  <th className="border-b border-border pb-2 pr-3">Failed</th>
                  <th className="border-b border-border pb-2">Blocked</th>
                </tr>
              </thead>
              <tbody>
                {moduleGroups.map(m => {
                  const passRate =
                    m.executed === 0 ? null : Math.round((m.passed / m.executed) * 100);
                  const clickable = moduleGroups.length > 1;
                  return (
                    <tr
                      key={m.name}
                      onClick={() =>
                        clickable && setModuleFilter(f => (f === m.name ? '' : m.name))
                      }
                      className={cn(
                        'border-b border-border last:border-b-0',
                        clickable && 'cursor-pointer hover:bg-surface-2',
                        moduleFilter === m.name && 'bg-primary-light/50',
                      )}
                    >
                      <td className="py-2.5 pr-3 font-medium text-text">{m.name}</td>
                      <td className="py-2.5 pr-3 text-text-2">
                        {m.executed} / {m.total}
                      </td>
                      <td className="py-2.5 pr-3 font-medium text-warning">
                        {passRate === null ? '—' : `${passRate}%`}
                      </td>
                      <td className="py-2.5 pr-3 text-danger">{m.failed || '—'}</td>
                      <td className="py-2.5 text-warning">{m.blocked || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors',
                filter === t.key
                  ? 'bg-primary text-white shadow-sm'
                  : 'border border-border bg-surface text-text-2 hover:bg-surface-2',
              )}
            >
              {t.label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px]',
                  filter === t.key ? 'bg-white/20' : 'bg-surface-2 text-text-3',
                )}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* Two-column body */}
        <div className="flex items-start gap-5">
          <section className="min-w-0 flex-1">
            {loading ? (
              <EmptyState icon="ti-loader-2" title="Loading runs…" body="" spin />
            ) : filteredRuns.length === 0 ? (
              runs.length === 0 ? (
                <EmptyRunsRecovery
                  scopeType={cycle.scopeType}
                  onRegenerate={
                    onRegenerate && cycle.scopeType !== 'Custom'
                      ? () => onRegenerate(cycle.id)
                      : undefined
                  }
                />
              ) : (
                <EmptyState
                  icon="ti-list-check"
                  title={
                    filter === 'Recurring'
                      ? 'No recurring issues here'
                      : 'No runs match this filter'
                  }
                  body={
                    filter === 'Recurring'
                      ? 'Nothing in this run has failed before.'
                      : 'Try the All tab.'
                  }
                />
              )
            ) : (
              <div className="flex flex-col gap-2">
                {filteredRuns.map(run => {
                  const isSel = run.id === selectedRunId;
                  const tc = run.testCase;
                  const isRecurring = recurringIds.has(run.testCaseId);
                  const isExpanded = expandedCaseId === run.testCaseId;
                  return (
                    <div key={run.id} className="flex flex-col gap-1.5">
                      <div
                        onClick={() => setSelectedRunId(run.id)}
                        className={cn(
                          'flex cursor-pointer items-center justify-between gap-3 rounded-lg border-y border-l-4 border-r border-border bg-surface px-3.5 py-2.5 transition-colors',
                          resultBorderTone(run),
                          isSel ? 'bg-primary-light/40' : 'hover:bg-surface-2',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="flex-shrink-0 font-mono text-[11px] text-text-3">
                              TC-{String(tc.caseNum).padStart(2, '0')}
                            </span>
                            <Pill className={priorityDisplay(tc).classes}>
                              {priorityDisplay(tc).label}
                            </Pill>
                            <span className="truncate text-[11px] text-text-3">
                              {caseScopePath(run)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[13px] font-medium text-text">
                            {tc.title}
                          </p>
                        </div>

                        <div
                          className="flex flex-shrink-0 items-center gap-1"
                          onClick={e => e.stopPropagation()}
                        >
                          <QuickAction
                            icon="ti-check"
                            active={!run.customResultId && run.result === 'Passed'}
                            tone="success"
                            onClick={() => onSubmitResult(run.id, 'Passed')}
                            title="Mark Passed"
                          />
                          <QuickAction
                            icon="ti-x"
                            active={!run.customResultId && run.result === 'Failed'}
                            tone="danger"
                            onClick={() => onSubmitResult(run.id, 'Failed')}
                            title="Mark Failed"
                          />
                          <QuickAction
                            icon="ti-alert-triangle"
                            active={!run.customResultId && run.result === 'Blocked'}
                            tone="warning"
                            onClick={() => onSubmitResult(run.id, 'Blocked')}
                            title="Mark Blocked"
                          />
                          <QuickAction
                            icon="ti-player-skip-forward"
                            active={!run.customResultId && run.result === 'Skipped'}
                            tone="muted"
                            onClick={() => onSubmitResult(run.id, 'Skipped')}
                            title="Skip"
                          />
                        </div>

                        <div className="flex flex-shrink-0 items-center gap-2">
                          <ResultChip run={run} />
                          {isRecurring && (
                            <button
                              type="button"
                              title="Show history across cycles"
                              onClick={e => {
                                e.stopPropagation();
                                setExpandedCaseId(isExpanded ? null : run.testCaseId);
                              }}
                              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-3 hover:bg-surface-2 hover:text-text"
                            >
                              <i
                                className={cn(
                                  'ti ti-chevron-down text-[13px] transition-transform',
                                  isExpanded && 'rotate-180',
                                )}
                              />
                            </button>
                          )}
                        </div>
                      </div>

                      {isRecurring && isExpanded && (
                        <RecurringHistoryPanel testCaseId={run.testCaseId} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* RIGHT — selected-case detail panel */}
          {selectedRun && (
            <SelectedCasePanel
              key={selectedRun.id}
              run={selectedRun}
              readOnly={false}
              projectId={projectId}
              onSubmitResult={onSubmitResult}
            />
          )}
        </div>
      </div>

      {showReport && (
        <CycleReportModal
          cycleId={cycle.id}
          projectId={projectId}
          onClose={() => setShowReport(false)}
        />
      )}

      {showEdit && (
        <UpdateQuickLogModal
          log={cycle}
          projectId={projectId}
          onClose={() => setShowEdit(false)}
          onSave={async patch => {
            await onUpdate(cycle.id, patch);
            setShowEdit(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Jira sync panel ─────────────────────────────────────────
// Shown whenever this run has a ticket link. "Sync from Jira" pulls the
// ticket's status and its sub-issues' Critical/Major/Minor and Done/
// Remaining/Reopened breakdown into this SAME cycle's count columns (see
// lib/jira.ts) -- the columns normally hold a Manual quick log's manually-
// entered counts, but nothing stops a case-based run from having its own
// Jira-synced snapshot alongside the live pass/fail stats above, which stay
// driven by the actual TestRun rows regardless.
function JiraSyncPanel({
  cycle,
  projectId,
  siteUrl,
  onUpdate,
}: {
  cycle: TestCycle;
  projectId: string | null;
  siteUrl: string | null;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const jiraConnected = siteUrl !== null;
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  const syncFromJira = async () => {
    if (!projectId || !cycle.ticketLink) return;
    setSyncError('');
    setSyncing(true);
    try {
      const result = await api.post<{
        status: string;
        issueCount: number;
        criticalCount: number;
        majorCount: number;
        minorCount: number;
        doneCount: number;
        remainingCount: number;
        reopenedCount: number;
        siteUrl: string;
        subIssues: JiraSubIssueInfo[];
      }>(`/api/projects/${projectId}/integrations/jira/fetch`, { ticketLink: cycle.ticketLink });
      await onUpdate(cycle.id, {
        issueCount: result.issueCount,
        criticalCount: result.criticalCount,
        majorCount: result.majorCount,
        minorCount: result.minorCount,
        doneCount: result.doneCount,
        remainingCount: result.remainingCount,
        reopenedCount: result.reopenedCount,
        jiraStatus: result.status,
        jiraSyncedAt: new Date().toISOString(),
        jiraSiteUrl: result.siteUrl,
        jiraSubIssues: result.subIssues,
      });
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const issueCount = cycle.issueCount ?? 0;
  const critical = cycle.criticalCount ?? 0;
  const major = cycle.majorCount ?? 0;
  const minor = cycle.minorCount ?? 0;
  const done = cycle.doneCount ?? 0;
  const remaining = cycle.remainingCount ?? 0;
  const reopened = cycle.reopenedCount ?? 0;
  const synced = !!cycle.jiraSyncedAt;
  const progress = done + remaining === 0 ? 0 : Math.round((done / (done + remaining)) * 100);

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] font-medium text-text">
          <i className="ti ti-brand-jira text-[15px] text-text-3" />
          <JiraTicketLink
            ticketLink={cycle.ticketLink!}
            siteUrl={cycle.jiraSiteUrl ?? siteUrl}
            className="truncate font-mono text-[12px] text-text-2"
          />
        </div>
        {jiraConnected && (
          <button
            type="button"
            disabled={syncing}
            onClick={syncFromJira}
            className="flex-shrink-0 whitespace-nowrap rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? (
              <i className="ti ti-loader-2 animate-spin text-[13px]" />
            ) : synced ? (
              'Re-sync from Jira'
            ) : (
              'Sync from Jira'
            )}
          </button>
        )}
      </div>

      {syncError && <p className="mt-2 text-[11.5px] font-medium text-danger">{syncError}</p>}

      {synced && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 text-[11px] text-text-3">
            Jira status: <span className="font-medium text-text-2">{cycle.jiraStatus}</span>
            {cycle.jiraSyncedAt && ` · synced ${new Date(cycle.jiraSyncedAt).toLocaleString()}`}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-[10.5px] uppercase tracking-wider text-text-3">Total issues</p>
              <p className="mt-0.5 text-[16px] font-bold tabular-nums text-text">{issueCount}</p>
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-wider text-text-3">Severity</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] font-medium">
                <span className="text-danger">{critical} Critical</span>
                <span className="text-warning">{major} Major</span>
                <span className="text-text-2">{minor} Minor</span>
              </div>
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-wider text-text-3">Progress</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="h-1.5 w-16 flex-shrink-0 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className={cn(
                      'block h-full rounded-full',
                      progress === 100 ? 'bg-success' : 'bg-primary',
                    )}
                    style={{ width: `${progress}%` }}
                  />
                </span>
                <span className="flex-shrink-0 text-[12px] tabular-nums text-text-2">
                  {done}/{done + remaining} done
                </span>
              </div>
            </div>
            {reopened > 0 && (
              <div>
                <p className="text-[10.5px] uppercase tracking-wider text-text-3">Reopened</p>
                <p className="mt-0.5 text-[16px] font-bold tabular-nums text-warning">{reopened}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KPI card ───────────────────────────────────────────────

function KpiCard({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: number;
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

// ─── Quick inline action button ─────────────────────────────

function QuickAction({
  icon,
  active,
  tone,
  onClick,
  title,
}: {
  icon: string;
  active: boolean;
  tone: 'success' | 'danger' | 'warning' | 'muted';
  onClick: () => void;
  title: string;
}) {
  const activeCls =
    tone === 'success'
      ? 'border-success bg-success-bg text-success-text'
      : tone === 'danger'
        ? 'border-danger bg-danger-bg text-danger-text'
        : tone === 'warning'
          ? 'border-warning bg-warning-bg text-warning-text'
          : 'border-border-strong bg-surface-2 text-text';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border transition-colors',
        active ? activeCls : 'border-border text-text-3 hover:bg-surface-2',
      )}
    >
      <i className={cn('ti', icon, 'text-[13px]')} />
    </button>
  );
}

function resultBorderTone(run: ApiTestRun): string {
  return resultToneDisplay(run).borderL;
}

// ─── Recurring issue history (expands under a recurring row) ──

interface RunHistoryItem {
  id: string;
  result: RunResult;
  ts: string;
  cycleId: string;
  cycleName: string;
}

// Reuses the same case-history endpoint TestCaseView's "Execution History"
// card already fetches from -- one real run log, no separate recurring-only
// data path to keep in sync.
function RecurringHistoryPanel({ testCaseId }: { testCaseId: string }) {
  const [runs, setRuns] = useState<RunHistoryItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    api
      .get<{ items: RunHistoryItem[] }>(`/api/test-cases/${testCaseId}/runs`)
      .then(d => {
        if (!cancelled) setRuns(d.items);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [testCaseId]);

  return (
    <div className="ml-4 rounded-lg border border-dashed border-border bg-surface-2/40 px-3.5 py-2.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-3">
        History across cycles
      </p>
      {runs === null ? (
        <p className="text-[12px] text-text-3">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-[12px] text-text-3">No prior runs recorded.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {runs.map(r => {
            const t = resultTone(r.result === 'NotRun' ? null : r.result);
            return (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 truncate text-[12.5px] text-text">{r.cycleName}</span>
                <span className="flex flex-shrink-0 items-center gap-3">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 text-[12px] font-medium',
                      t.text,
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', t.dot)} />
                    {t.label}
                  </span>
                  <span className="text-[10.5px] text-text-3">{relativeTime(r.ts)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Selected case right-side panel ──────────────────────────

function SelectedCasePanel({
  run,
  readOnly,
  projectId,
  onSubmitResult,
}: {
  run: ApiTestRun;
  readOnly: boolean;
  projectId: string | null;
  onSubmitResult: (runId: string, result: string, notes?: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState(run.notes);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedNotes, setSavedNotes] = useState(false);
  const tc = run.testCase;
  const resultOptions = useRunResultOptions(projectId);

  // Reset local notes when the selected run changes.
  useEffect(() => {
    setNotes(run.notes);
  }, [run.id, run.notes]);

  // A custom result's own color doesn't have a matching border/ring combo
  // (only pill/dot/text/borderL, see lib/colors.ts) -- a neutral frame for
  // that case is a reasonable trade rather than adding a 5th color variant
  // just for this one card.
  const tone = run.customResultId
    ? 'border-border ring-surface-2'
    : run.result === 'Passed'
      ? 'border-emerald-300 ring-emerald-100'
      : run.result === 'Failed'
        ? 'border-red-300 ring-red-100'
        : run.result === 'Blocked'
          ? 'border-amber-300 ring-amber-100'
          : run.result === 'Skipped'
            ? 'border-slate-300 ring-slate-100'
            : 'border-border ring-surface-2';

  const labelTone = resultToneDisplay(run).text;

  const submit = async (result: string) => {
    setSaving(result);
    try {
      await onSubmitResult(run.id, result, notes);
      setSavedNotes(true);
      setTimeout(() => setSavedNotes(false), 1500);
    } finally {
      setSaving(null);
    }
  };

  return (
    <aside
      className={cn(
        'sticky top-2 w-[320px] flex-shrink-0 self-start overflow-hidden rounded-lg border-2 bg-surface ring-2',
        tone,
      )}
    >
      <div className="px-4 pb-3 pt-4">
        <div className={cn('mb-1 text-[10px] font-semibold uppercase tracking-widest', labelTone)}>
          Selected · {resultToneDisplay(run).label}
        </div>
        <div className="font-mono text-[11px] text-text-3">
          TC-{String(tc.caseNum).padStart(2, '0')}
        </div>
        <h3 className="mt-0.5 text-[14px] font-semibold leading-snug text-text">{tc.title}</h3>
        <p className="mt-1 text-[11px] text-text-3">{caseScopePath(run)}</p>

        <div className="mt-2 flex flex-wrap gap-1">
          <Pill className={priorityDisplay(tc).classes}>{priorityDisplay(tc).label}</Pill>
          <Pill className={severityDisplay(tc).classes}>{severityDisplay(tc).label}</Pill>
          <Pill className={typeDisplay(tc).classes}>{typeDisplay(tc).label}</Pill>
        </div>
      </div>

      {/* Comment */}
      <div className="border-t border-border px-4 py-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-3">
          Comment
        </p>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          readOnly={readOnly}
          placeholder={
            readOnly
              ? 'Run is closed — comments are read-only.'
              : 'Notes, repro steps, environment…'
          }
          className={cn(
            'w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light',
            readOnly && 'bg-surface-2/40',
          )}
        />
        {savedNotes && <p className="mt-1 text-[11px] text-emerald-600">Saved ✓</p>}
      </div>

      {/* Evidence (placeholder tiles — upload backend pending) */}
      <div className="border-t border-border px-4 py-3">
        <p className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-text-3">
          Evidence
          <span className="rounded bg-surface-2 px-1.5 py-px text-[9px] font-normal normal-case text-text-3">
            Coming soon
          </span>
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          <EvidenceTile icon="ti-photo" />
          <EvidenceTile icon="ti-video" />
          <EvidenceTile icon="ti-plus" dashed />
        </div>
      </div>

      {/* Submit result */}
      {!readOnly && (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-text-3">
            Submit result
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {resultOptions.map(o => {
              const isCurrent = run.customResultId
                ? run.customResultId === o.key
                : run.result === o.key;
              const builtinStyle = RESULT_BTN[o.key as RunResult];
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => submit(o.key)}
                  disabled={saving !== null}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    builtinStyle ?? colorClassesOf(o.color).pill.replace('ring-', 'border-'),
                    isCurrent && 'ring-2 ring-primary-light',
                  )}
                >
                  {saving === o.key ? 'Saving…' : o.name}
                </button>
              );
            })}
          </div>
          {!(!run.customResultId && run.result === 'NotRun') && (
            <button
              type="button"
              onClick={() => submit('NotRun')}
              disabled={saving !== null}
              className="mt-2 w-full rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-text-3 hover:bg-surface-2"
            >
              Reset to Not run
            </button>
          )}
          {run.executedAt && (
            <p className="mt-2 text-[10px] text-text-3">
              Last submitted {timeAgo(run.executedAt)}
              {run.executedBy ? ` by ${run.executedBy}` : ''}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

// ─── Visual atoms ──────────────────────────────────────────

function ResultChip({ run }: { run: ApiTestRun }) {
  if (!run.customResultId && run.result === 'NotRun') {
    return <span className="text-[12px] text-text-3">—</span>;
  }
  const t = resultToneDisplay(run);
  return (
    <span className={cn('whitespace-nowrap text-[12.5px] font-medium', t.text)}>{t.label}</span>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium leading-[1.5]',
        className,
      )}
    >
      {children}
    </span>
  );
}

function EvidenceTile({ icon, dashed }: { icon: string; dashed?: boolean }) {
  return (
    <div
      className={cn(
        'flex aspect-[4/3] items-center justify-center rounded-md text-text-3',
        dashed ? 'border border-dashed border-border-strong hover:bg-surface-2' : 'bg-surface-2',
      )}
    >
      <i className={cn('ti', icon, 'text-[20px]')} />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  spin,
}: {
  icon: string;
  title: string;
  body: string;
  spin?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface py-20 text-text-3">
      <i className={cn('ti', icon, 'text-[36px] opacity-50', spin && 'animate-spin')} />
      <p className="text-[14px] font-medium text-text-2">{title}</p>
      {body && <p className="max-w-[260px] text-center text-[12px]">{body}</p>}
    </div>
  );
}

// Recovery panel shown when a cycle ended up with zero runs.
// Most common cause: the scope was wrong at creation (e.g. a module id submitted as a
// suiteId). Repopulate re-evaluates the scope and fills in the missing runs.
function EmptyRunsRecovery({
  scopeType,
  onRegenerate,
}: {
  scopeType: string;
  onRegenerate?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-amber-300 bg-amber-50/40 px-6 py-16 text-center">
      <i className="ti ti-mood-empty text-[36px] text-amber-500" />
      <div>
        <p className="text-[14px] font-medium text-text">No test cases in this run</p>
        <p className="mt-1 max-w-[420px] text-[12px] text-text-2">
          {scopeType === 'Custom'
            ? 'This run was created with a custom case selection that ended up empty. Create a new run and pick test cases explicitly.'
            : 'The scope didn’t match any cases when this run was created (or new cases have been added since). Repopulate to fill in the matching cases now.'}
        </p>
      </div>
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-primary-hover"
        >
          <i className="ti ti-refresh text-[14px]" />
          Repopulate test cases
        </button>
      )}
    </div>
  );
}

// ─── Progress bar (kept stable since other screens / report import it) ─

interface SegBarProps {
  counts: { Passed: number; Failed: number; Blocked: number; Skipped: number; NotRun: number };
  total: number;
  height?: number;
}

export function SegmentedProgressBar({ counts, total, height = 6 }: SegBarProps) {
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const segments = [
    { color: 'bg-emerald-500', width: pct(counts.Passed), title: `Passed: ${counts.Passed}` },
    { color: 'bg-red-500', width: pct(counts.Failed), title: `Failed: ${counts.Failed}` },
    { color: 'bg-amber-500', width: pct(counts.Blocked), title: `Blocked: ${counts.Blocked}` },
    { color: 'bg-slate-400', width: pct(counts.Skipped), title: `Skipped: ${counts.Skipped}` },
  ];
  return (
    <div className="flex overflow-hidden rounded-full bg-slate-100" style={{ height }}>
      {segments.map(
        (s, i) =>
          s.width > 0 && (
            <div
              key={i}
              title={s.title}
              className={`h-full ${s.color} transition-all`}
              style={{ width: `${s.width}%` }}
            />
          ),
      )}
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
