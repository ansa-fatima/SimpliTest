'use client';

import { useEffect, useMemo, useState } from 'react';
import { TestCycle, CycleStatus, CycleMode, Module } from '@/types';
import { Button } from '@/components/ui/Button';
import { NewCycleModal, CycleFormPayload } from './NewCycleModal';
import { CycleReportModal } from './CycleReportModal';
import { ManualCycleSummaryModal } from './ManualCycleSummaryModal';
import { cn } from '@/lib/utils';

interface CyclesListProps {
  cycles: TestCycle[];
  loading: boolean;
  modules: Module[];
  projectId: string | null;
  onOpen: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: (input: CycleFormPayload) => Promise<void>;
  onUpdate?: (id: string, patch: Record<string, unknown>) => Promise<void>;
}

const STATUS_BADGE: Record<CycleStatus, string> = {
  Active: 'bg-amber-50 text-amber-700 ring-amber-200',
  Completed: 'bg-blue-50 text-blue-700 ring-blue-200',
  Archived: 'bg-amber-50 text-amber-700 ring-amber-200',
};

type ModeFilter = 'all' | 'CaseBased' | 'Manual';
type SortKey = 'date' | 'portal' | 'module' | 'status';

// Cycles with no name on a field (e.g. an 'All'-scoped run has no portal/module)
// always sort to the end, regardless of direction — a blank isn't "less than"
// a real value, it just doesn't have one to compare.
function compareNullsLast(a: string | null | undefined, b: string | null | undefined, dir: 1 | -1) {
  const aEmpty = !a;
  const bEmpty = !b;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  return dir * a!.localeCompare(b!);
}

export function CyclesList({
  cycles,
  loading,
  modules,
  projectId,
  onOpen,
  onArchive,
  onDelete,
  onCreate,
  onUpdate,
}: CyclesListProps) {
  const [filter, setFilter] = useState<CycleStatus | 'All'>('All');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  // Date/newest-first is the default so a newly-added cycle lands in the right
  // spot with no extra step — it's just where a fresh `cycles` array sorts to.
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [createMode, setCreateMode] = useState<CycleMode | null>(null);
  const [editingCycle, setEditingCycle] = useState<TestCycle | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [summaryFor, setSummaryFor] = useState<TestCycle | null>(null);

  const filtered = cycles.filter(c => {
    if (filter !== 'All' && c.status !== filter) return false;
    if (modeFilter !== 'all' && (c.mode ?? 'CaseBased') !== modeFilter) return false;
    return true;
  });

  const manualCount = cycles.filter(c => (c.mode ?? 'CaseBased') === 'Manual').length;
  const detailedCount = cycles.length - manualCount;

  // Status is always one of: Open to do / Completed / Archived — no other
  // wording ("Done", "Open-to-do") so the label is consistent everywhere.
  // Quick logs (Manual) are always Completed the moment they're logged —
  // whether the issues they found are still open is a separate question,
  // answered by the Passed/Failed verdict, not by this lifecycle status.
  const cycleStatusBadge = (c: TestCycle): { label: string; cls: string } => {
    if ((c.mode ?? 'CaseBased') === 'Manual') {
      if (c.status === 'Archived') return { label: 'Archived', cls: STATUS_BADGE.Archived };
      return { label: 'Completed', cls: STATUS_BADGE.Completed };
    }
    if (c.status === 'Active') return { label: 'Open to do', cls: STATUS_BADGE.Active };
    return { label: c.status, cls: STATUS_BADGE[c.status] };
  };

  // Quick-logs show the executed-on date (back-datable) so cycles sort by
  // when they actually ran, not when the record was typed up.
  const cycleDate = (c: TestCycle) =>
    new Date(((c.mode ?? 'CaseBased') === 'Manual' && c.completedAt) || c.createdAt).getTime();

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'portal':
          return compareNullsLast(a.portalName, b.portalName, dir);
        case 'module':
          return compareNullsLast(a.moduleName, b.moduleName, dir);
        case 'status':
          return dir * cycleStatusBadge(a).label.localeCompare(cycleStatusBadge(b).label);
        case 'date':
        default:
          return dir * (cycleDate(a) - cycleDate(b));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">
              Test runs
            </h1>
            <p className="text-[13px] text-text-2">
              Track execution cycles — detailed per-test-case or quick aggregate logs.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCreateMode('Manual')}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-[7px] text-[13px] text-text transition-colors hover:bg-surface-2"
              title="Log a cycle by aggregate counts (no test cases required)"
            >
              <i className="ti ti-clipboard-plus text-[15px]" />
              Quick log
            </button>
            <button
              type="button"
              onClick={() => setCreateMode('CaseBased')}
              className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-[7px] text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover"
            >
              <i className="ti ti-plus text-[15px]" />
              New test run
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <Tab
            active={modeFilter === 'all'}
            onClick={() => setModeFilter('all')}
            label="All cycles"
            count={cycles.length}
          />
          <Tab
            active={modeFilter === 'CaseBased'}
            onClick={() => setModeFilter('CaseBased')}
            label="Detailed"
            count={detailedCount}
          />
          <Tab
            active={modeFilter === 'Manual'}
            onClick={() => setModeFilter('Manual')}
            label="Quick logs"
            count={manualCount}
          />

          <span className="mx-2 h-4 w-px bg-border" />

          {(['All', 'Active', 'Completed', 'Archived'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={cn(
                'cursor-pointer rounded-full px-2.5 py-1 text-[12px] transition-colors',
                filter === s
                  ? 'bg-primary text-white shadow-sm'
                  : 'border border-border bg-surface text-text-2 hover:bg-surface-2',
              )}
            >
              {s}
            </button>
          ))}

          {/* Sort */}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] text-text-3">Sort by</span>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="rounded-[7px] border border-border bg-surface px-2 py-1 text-[12px] text-text outline-none focus:border-primary"
            >
              <option value="date">Date</option>
              <option value="portal">Portal</option>
              <option value="module">Module</option>
              <option value="status">Status</option>
            </select>
            <button
              type="button"
              onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
              title={
                sortDir === 'asc'
                  ? 'Ascending — click for descending'
                  : 'Descending — click for ascending'
              }
              className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-border bg-surface text-text-2 hover:bg-surface-2"
            >
              <i
                className={cn(
                  'ti',
                  sortDir === 'asc' ? 'ti-sort-ascending' : 'ti-sort-descending',
                  'text-[14px]',
                )}
              />
            </button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-24 text-sm text-text-3">
            Loading cycles…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface py-20 text-text-3">
            <i className="ti ti-list-check text-[36px] opacity-50" />
            <p className="text-[14px] font-medium text-text-2">
              {cycles.length === 0 ? 'No test runs yet' : 'No runs match this filter'}
            </p>
            <p className="max-w-[320px] text-center text-[12px]">
              {cycles.length === 0
                ? 'Use Quick log for a simple counts-only record, or New test run for case-by-case execution.'
                : 'Try widening the tabs above.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="bg-surface-2">
                <tr>
                  <Th>Name</Th>
                  <Th>Date</Th>
                  <Th>Portal</Th>
                  <Th>Module</Th>
                  <Th>Feature</Th>
                  <Th>Environment</Th>
                  <Th>Platform</Th>
                  <Th>Version</Th>
                  <Th>Cycle type</Th>
                  <Th>Ticket</Th>
                  <Th width="60px" align="right">
                    Issues
                  </Th>
                  <Th width="60px" align="right">
                    Crit
                  </Th>
                  <Th width="60px" align="right">
                    Major
                  </Th>
                  <Th width="60px" align="right">
                    Minor
                  </Th>
                  <Th width="60px" align="right">
                    Done
                  </Th>
                  <Th width="60px" align="right">
                    Remain
                  </Th>
                  <Th width="100px">Status</Th>
                  <th className="w-[120px] border-b border-border px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(c => {
                  const isManual = (c.mode ?? 'CaseBased') === 'Manual';
                  const status = cycleStatusBadge(c);

                  // For CaseBased cycles, derive the counts from the embedded summary.
                  const summary = c.summary;
                  const counts = summary?.counts ?? {
                    NotRun: 0,
                    Passed: 0,
                    Failed: 0,
                    Blocked: 0,
                    Skipped: 0,
                  };

                  const severity = summary?.severity ?? { Critical: 0, Major: 0, Minor: 0 };
                  const total = summary?.total ?? 0;

                  const issueCount = isManual
                    ? (c.issueCount ?? 0)
                    : counts.Failed + counts.Blocked;
                  const done = isManual ? (c.doneCount ?? 0) : counts.Passed;
                  // "Remaining" means the same thing everywhere: issues still
                  // open and needing a retest — for a case-based cycle that's
                  // the currently-failed OR blocked cases (both still need
                  // attention), not the ones that just haven't been run yet
                  // (NotRun is a separate, unrelated state).
                  const remaining = isManual
                    ? (c.remainingCount ?? 0)
                    : counts.Failed + counts.Blocked;

                  return (
                    <tr
                      key={c.id}
                      onClick={() => {
                        if (isManual) setSummaryFor(c);
                        else onOpen(c.id);
                      }}
                      className="group cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-surface-2"
                    >
                      <td className="max-w-[160px] px-3 py-2.5 font-medium text-text">
                        <span className="inline-flex max-w-full items-center gap-1.5">
                          <span className="truncate" title={c.name}>
                            {c.name}
                          </span>
                          {/* Resolution status — for a quick log, only shown
                              once Done/Remaining have actually been filled in
                              (e.g. after editing following a retest), not for
                              every quick log by default. For a case-based
                              cycle, shown once anything has actually run. */}
                          {isManual
                            ? ((c.doneCount ?? 0) > 0 || (c.remainingCount ?? 0) > 0) && (
                                <span
                                  className={cn(
                                    'h-[7px] w-[7px] flex-shrink-0 rounded-full',
                                    (c.remainingCount ?? 0) === 0 ? 'bg-emerald-500' : 'bg-red-500',
                                  )}
                                  title={
                                    (c.remainingCount ?? 0) === 0
                                      ? 'Fully resolved'
                                      : `${c.remainingCount} issue(s) still open`
                                  }
                                />
                              )
                            : // Only claim "resolved" once every case has actually
                              // been executed — otherwise a run that's 30% done
                              // with zero failures so far would show the same
                              // green dot as one that's actually finished clean.
                              total > 0 &&
                              counts.NotRun === 0 && (
                                <span
                                  className={cn(
                                    'h-[7px] w-[7px] flex-shrink-0 rounded-full',
                                    remaining === 0 ? 'bg-emerald-500' : 'bg-red-500',
                                  )}
                                  title={
                                    remaining === 0
                                      ? 'Fully resolved'
                                      : `${remaining} case(s) still failing or blocked`
                                  }
                                />
                              )}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-text-2">
                        {/* Quick-logs show the executed-on date (back-datable) so
                            cycles sort by when they actually ran, not when typed. */}
                        {new Date((isManual && c.completedAt) || c.createdAt).toLocaleDateString(
                          'en-GB',
                          {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          },
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {/* Portal/Module are resolved server-side for both cycle
                            modes (see /api/cycles), so both columns can just
                            render the field directly — no per-mode branching. */}
                        {c.portalName ? (
                          <Chip color="slate" text={c.portalName} />
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {c.moduleName ? (
                          <Chip color="emerald" text={c.moduleName} />
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-text">
                        {isManual ? (
                          c.featureName || <span className="text-text-3">—</span>
                        ) : c.scopeType === 'Suite' && c.scopeName ? (
                          (c.scopeName.split(' / ')[1] ?? c.scopeName)
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {c.environment ? (
                          <Chip color="red-50" text={c.environment} />
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {c.platform ? (
                          <Chip color="green-50" text={c.platform} />
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11.5px] text-text-2">
                        {c.version || <span className="text-text-3">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {c.cycleCategory ? (
                          <Chip color="yellow" text={c.cycleCategory} />
                        ) : isManual ? (
                          <span className="text-text-3">—</span>
                        ) : (
                          <Chip color="slate" text={c.scopeType} />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[11.5px]">
                        {c.ticketLink ? (
                          renderTicketLink(c.ticketLink)
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text">
                        {issueCount || <span className="text-text-3">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-red-700">
                        {(isManual ? (c.criticalCount ?? 0) : severity.Critical) || (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">
                        {(isManual ? (c.majorCount ?? 0) : severity.Major) || (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                        {(isManual ? (c.minorCount ?? 0) : severity.Minor) || (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">
                        {done || <span className="text-text-3">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-red-700">
                        {remaining || <span className="text-text-3">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1',
                            status.cls,
                          )}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td
                        className="whitespace-nowrap px-2 py-2.5 text-right"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => (isManual ? setSummaryFor(c) : setReportFor(c.id))}
                            className="rounded border border-border bg-surface px-2 py-0.5 text-[11px] text-text-2 hover:bg-surface-2"
                            title="Copy summary"
                          >
                            <i className="ti ti-clipboard-text" />
                          </button>
                          <button
                            type="button"
                            onClick={() => (isManual ? setEditingCycle(c) : onOpen(c.id))}
                            className="rounded border border-border bg-surface px-2 py-0.5 text-[11px] text-text-2 hover:bg-surface-2"
                            title={isManual ? 'Edit' : 'Open'}
                          >
                            <i className={cn('ti', isManual ? 'ti-pencil' : 'ti-arrow-right')} />
                          </button>
                          {c.status !== 'Archived' && (
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Archive "${c.name}"?`)) onArchive(c.id);
                              }}
                              className="rounded border border-border bg-surface px-2 py-0.5 text-[11px] text-text-2 hover:bg-amber-50 hover:text-amber-700"
                              title="Archive"
                            >
                              <i className="ti ti-archive" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                confirm(`Permanently delete "${c.name}"?\n\nThis cannot be undone.`)
                              )
                                onDelete(c.id);
                            }}
                            className="rounded border border-border bg-surface px-2 py-0.5 text-[11px] text-text-2 hover:bg-red-50 hover:text-red-700"
                            title="Delete"
                          >
                            <i className="ti ti-trash" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      {createMode && (
        <NewCycleModal
          modules={modules}
          projectId={projectId}
          defaultMode={createMode}
          onClose={() => setCreateMode(null)}
          onSave={async input => {
            await onCreate(input);
            setCreateMode(null);
          }}
        />
      )}

      {/* Edit modal (Manual cycles only) */}
      {editingCycle && (
        <NewCycleModal
          modules={modules}
          projectId={projectId}
          initial={editingCycle}
          onClose={() => setEditingCycle(null)}
          onSave={async input => {
            if (!onUpdate) return;
            const { mode: _, scopeType: __, scopeId: ___, ...patch } = input;
            await onUpdate(editingCycle.id, patch);
            setEditingCycle(null);
          }}
        />
      )}

      {reportFor && <CycleReportModal cycleId={reportFor} onClose={() => setReportFor(null)} />}

      {summaryFor && (
        <ManualCycleSummaryModal
          cycle={summaryFor}
          onClose={() => setSummaryFor(null)}
          onEdit={() => {
            setEditingCycle(summaryFor);
            setSummaryFor(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────

function Tab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12.5px] transition-colors',
        active
          ? 'border border-primary bg-primary-light font-semibold text-primary-text'
          : 'border border-border bg-surface text-text-2 hover:bg-surface-2',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-px text-[10px]',
          active ? 'bg-primary/15 text-primary-text' : 'bg-surface-2 text-text-3',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function Th({
  children,
  width,
  align,
}: {
  children: React.ReactNode;
  width?: string;
  align?: 'right' | 'left';
}) {
  return (
    <th
      style={width ? { width } : undefined}
      className={cn(
        'border-b border-border px-3 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.05em] text-text-3',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

// Pill-style chip used for the Module / Feature / Environment / Platform columns
// to match the spreadsheet's coloured rounded tags.
function Chip({
  color,
  text,
}: {
  color: 'emerald' | 'red-50' | 'green-50' | 'yellow' | 'slate';
  text: string | null | undefined;
}) {
  if (!text) return <span className="text-text-3">—</span>;
  const cls =
    color === 'emerald'
      ? 'bg-emerald-100 text-emerald-800'
      : color === 'red-50'
        ? 'bg-red-50 text-red-700'
        : color === 'green-50'
          ? 'bg-green-50 text-green-700'
          : color === 'yellow'
            ? 'bg-amber-50 text-amber-700'
            : 'bg-slate-100 text-slate-600';
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
        cls,
      )}
    >
      {text}
    </span>
  );
}

function renderTicketLink(value: string) {
  // If it looks like a URL, render as link. Otherwise show the text (e.g. NPD-10656) plain.
  const isUrl = /^https?:\/\//i.test(value);
  if (isUrl) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        onClick={e => e.stopPropagation()}
        className="text-primary hover:underline"
      >
        {value.replace(/^https?:\/\//, '').slice(0, 40)}
      </a>
    );
  }
  return <span className="font-mono text-text-2">{value}</span>;
}
