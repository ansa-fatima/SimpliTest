'use client';

import { useEffect, useState } from 'react';
import { TestCycle, CycleStatus, CycleMode, Module } from '@/types';
import { Button } from '@/components/ui/Button';
import { NewCycleModal, CycleFormPayload } from './NewCycleModal';
import { CycleReportModal } from './CycleReportModal';
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
  Active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Completed: 'bg-blue-50 text-blue-700 ring-blue-200',
  Archived: 'bg-amber-50 text-amber-700 ring-amber-200',
};

type ModeFilter = 'all' | 'CaseBased' | 'Manual';

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

  // Status auto-derives from "remaining" for manual cycles — convenient little flag.
  const cycleStatusBadge = (c: TestCycle): { label: string; cls: string } => {
    if ((c.mode ?? 'CaseBased') === 'Manual') {
      const remaining = c.remainingCount ?? 0;
      if (c.status === 'Archived') return { label: 'Archived', cls: STATUS_BADGE.Archived };
      if (remaining === 0 && (c.issueCount ?? 0) > 0)
        return { label: 'Done', cls: STATUS_BADGE.Completed };
      if ((c.issueCount ?? 0) === 0) return { label: c.status, cls: STATUS_BADGE[c.status] };
      return { label: 'Open-to-do', cls: 'bg-amber-50 text-amber-700 ring-amber-200' };
    }
    return { label: c.status, cls: STATUS_BADGE[c.status] };
  };

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
                  <Th>Date</Th>
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
                {filtered.map(c => {
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

                  const issueCount = isManual
                    ? (c.issueCount ?? 0)
                    : counts.Failed + counts.Blocked;
                  const done = isManual ? (c.doneCount ?? 0) : counts.Passed;
                  const remaining = isManual ? (c.remainingCount ?? 0) : counts.NotRun;

                  return (
                    <tr
                      key={c.id}
                      onClick={() => {
                        if (isManual) setEditingCycle(c);
                        else onOpen(c.id);
                      }}
                      className="group cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-surface-2"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 text-text-2">
                        {new Date(c.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-3 py-2.5">
                        {/* Module column — unified Chip styling across Manual + CaseBased.
                            For CaseBased we resolve module name from the scope ladder. */}
                        {(() => {
                          const modText = isManual
                            ? c.moduleName || c.portalName || (c.scopeName ?? '')
                            : c.scopeType === 'Portal' && c.scopeName
                              ? c.scopeName
                              : c.scopeType === 'Module' && c.scopeName
                                ? c.scopeName.split(' / ')[0]
                                : c.scopeType === 'Suite' && c.scopeName
                                  ? c.scopeName.split(' / ')[0]
                                  : '';
                          return modText ? (
                            <Chip color="emerald" text={modText} />
                          ) : (
                            <span className="text-text-3">—</span>
                          );
                        })()}
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
                        {isManual ? (
                          (c.criticalCount ?? 0) || <span className="text-text-3">—</span>
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">
                        {isManual ? (
                          (c.majorCount ?? 0) || <span className="text-text-3">—</span>
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                        {isManual ? (
                          (c.minorCount ?? 0) || <span className="text-text-3">—</span>
                        ) : (
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
        <ManualCycleSummaryModal cycle={summaryFor} onClose={() => setSummaryFor(null)} />
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

// ─── Manual cycle summary modal ─────────────────────────────
// Visually mirrors CycleReportModal exactly — same header, count cards, pass-rate /
// completion box, "Failed/Blocked" breakdown sections — so the two summary views feel
// identical regardless of whether the cycle is CaseBased or Manual.

function ManualCycleSummaryModal({ cycle, onClose }: { cycle: TestCycle; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  // Derived numbers (use 0 when fields are null/undefined).
  const critical = cycle.criticalCount ?? 0;
  const major = cycle.majorCount ?? 0;
  const minor = cycle.minorCount ?? 0;
  const done = cycle.doneCount ?? 0;
  const remaining = cycle.remainingCount ?? 0;
  const issues = cycle.issueCount ?? critical + major + minor;
  const passed = cycle.passedCount ?? 0;
  const failed = cycle.failedCount ?? 0;
  const blocked = cycle.blockedCount ?? 0;
  const totalCases = passed + failed + blocked;

  // Status: align with CycleReportModal's "Failed" vs "Passed" semantics.
  const isFailed = remaining > 0 || failed > 0 || blocked > 0;
  const statusPill = isFailed
    ? { circle: '🔴', label: 'Failed', cls: 'bg-red-50 text-red-700 border border-red-200' }
    : { circle: '🟢', label: 'Passed', cls: 'bg-green-50 text-green-700 border border-green-200' };

  // Pass rate / Completion %
  const passPercent = totalCases === 0 ? 0 : Math.round((passed / totalCases) * 100);
  const percent = issues === 0 ? 100 : Math.round((done / issues) * 100);

  const copy = async () => {
    const txt = formatManualCycleSummary(cycle);
    try {
      await navigator.clipboard.writeText(txt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this summary:', txt);
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // Scope-style meta line (Module / Feature, plus env/platform/version).
  const metaParts: string[] = [];
  if (cycle.moduleName) metaParts.push(cycle.moduleName);
  if (cycle.featureName) metaParts.push(cycle.featureName);
  if (cycle.environment) metaParts.push(cycle.environment);
  if (cycle.platform) metaParts.push(cycle.platform);
  if (cycle.version) metaParts.push(cycle.version);
  if (cycle.cycleCategory) metaParts.push(cycle.cycleCategory);
  const scopeLine = metaParts.join(' · ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 pb-4 pt-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">Test Run Summary</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">Snapshot for sharing in QA channels</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" onClick={copy}>
              {copied ? '✓ Copied' : '📋 Copy text'}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded p-1 text-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          {/* Cycle header */}
          <div>
            <h3 className="text-lg font-bold text-slate-900">{cycle.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider',
                  statusPill.cls,
                )}
              >
                <span className="text-sm">{statusPill.circle}</span> {statusPill.label}
              </span>
              {scopeLine && (
                <>
                  <span>·</span>
                  <span>
                    <strong className="text-slate-700">Scope:</strong> {scopeLine}
                  </span>
                </>
              )}
              <span>·</span>
              <span>{new Date(cycle.createdAt).toLocaleDateString()}</span>
              {cycle.ticketLink && (
                <>
                  <span>·</span>
                  <span className="font-mono text-slate-600">{cycle.ticketLink}</span>
                </>
              )}
            </div>
          </div>

          {/* Counts grid — matches CycleReportModal's 5-card layout */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <CountCard label="Total issues" value={issues} tone="neutral" />
            <CountCard label="Critical" value={critical} tone="negative" />
            <CountCard label="Major" value={major} tone="warning" />
            <CountCard label="Minor" value={minor} tone="neutral" />
            <CountCard label="Remaining" value={remaining} tone="negative" />
          </div>

          {/* Pass rate / Completion — same box as detailed report */}
          <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Pass rate
              </p>
              <p className="text-2xl font-bold text-green-600">{passPercent}%</p>
              <p className="text-[10px] text-slate-400">
                {totalCases === 0 ? 'No test cases recorded' : `${passed} of ${totalCases} passed`}
              </p>
            </div>
            <div className="h-10 w-px bg-slate-200" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Issue resolution
              </p>
              <p className="text-2xl font-bold text-blue-600">{percent}%</p>
              <p className="text-[10px] text-slate-400">
                {issues === 0 ? 'No issues recorded' : `${done} of ${issues} resolved`}
              </p>
            </div>
          </div>

          {/* Breakdown — Failed (open) — only when there's something to show */}
          {(critical > 0 || major > 0 || minor > 0 || remaining > 0) && (
            <ManualBreakdownSection
              title="Issues"
              tone="red"
              critical={critical}
              major={major}
              minor={minor}
              done={done}
              remaining={remaining}
            />
          )}

          {/* Test-case results breakdown (Passed / Failed / Blocked) — only when set */}
          {totalCases > 0 && (
            <ManualBreakdownSection
              title="Test case results"
              tone="amber"
              passed={passed}
              failed={failed}
              blocked={blocked}
            />
          )}

          {/* "All clear" message when nothing to report */}
          {issues === 0 && totalCases === 0 && (
            <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-600">
              ✓ No issues or test-case results recorded — looking clean!
            </p>
          )}

          {/* Notes */}
          {cycle.description && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Notes
              </p>
              <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {cycle.description}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Matches CycleReportModal's CountCard exactly (same tones + classes).
function CountCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  const cls =
    tone === 'positive'
      ? 'text-green-700 bg-green-50 border-green-200'
      : tone === 'negative'
        ? 'text-red-700 bg-red-50 border-red-200'
        : tone === 'warning'
          ? 'text-amber-700 bg-amber-50 border-amber-200'
          : 'text-slate-700 bg-slate-50 border-slate-200';
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${cls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

// Severity / category breakdown — visually mirrors CycleReportModal.BreakdownSection
// (left coloured border + 2-col grid of labelled lists), but the contents are the
// manual cycle's counts instead of per-case rows.
function ManualBreakdownSection(props: {
  title: string;
  tone: 'red' | 'amber';
  critical?: number;
  major?: number;
  minor?: number;
  done?: number;
  remaining?: number;
  passed?: number;
  failed?: number;
  blocked?: number;
}) {
  const sectionCls = props.tone === 'red' ? 'border-red-200' : 'border-amber-200';
  const headerCls = props.tone === 'red' ? 'text-red-700' : 'text-amber-700';

  const isIssues = typeof props.critical === 'number';

  return (
    <div className={`border-l-4 ${sectionCls} pl-4`}>
      <h4 className={`text-sm font-bold ${headerCls} mb-2`}>{props.title}</h4>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
        {isIssues ? (
          <>
            <BreakdownList
              label="Severity"
              rows={[
                ['Critical', props.critical ?? 0, 'text-red-700'],
                ['Major', props.major ?? 0, 'text-amber-700'],
                ['Minor', props.minor ?? 0, 'text-slate-600'],
              ]}
            />
            <BreakdownList
              label="Resolution"
              rows={[
                ['Done', props.done ?? 0, 'text-green-700'],
                ['Remaining', props.remaining ?? 0, 'text-red-700'],
              ]}
            />
          </>
        ) : (
          <>
            <BreakdownList
              label="Outcome"
              rows={[
                ['Passed', props.passed ?? 0, 'text-green-700'],
                ['Failed', props.failed ?? 0, 'text-red-700'],
                ['Blocked', props.blocked ?? 0, 'text-amber-700'],
              ]}
            />
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="mb-1.5 text-xs font-bold text-slate-700">Totals:</p>
              <ul className="flex flex-col gap-0.5">
                <li className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-600">Total cases:</span>
                  <span className="font-mono font-bold text-slate-700">
                    {(props.passed ?? 0) + (props.failed ?? 0) + (props.blocked ?? 0)}
                  </span>
                </li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BreakdownList({ label, rows }: { label: string; rows: [string, number, string][] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <p className="mb-1.5 text-xs font-bold text-slate-700">{label}:</p>
      <ul className="flex flex-col gap-0.5">
        {rows.map(([k, v, c]) => (
          <li key={k} className="flex items-center justify-between text-xs">
            <span className={`font-semibold ${c}`}>{k}:</span>
            <span className={`font-mono font-bold ${c}`}>{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Slack-friendly plain text. Compact single-headline format like:
//   Parent Portal/Login - iPhone - Regression V 3.7.1 (68) (completed)
//
//   Environment: QA
//   Status: :red_circle: Failed
//   Total Issues Reported: 20
//   Severity:
//   Critical: 05
//   Major: 13
//   Minor: 02
//
// Empty meta fields are skipped from the headline so it stays clean for sparse cycles.
export function formatManualCycleSummary(c: TestCycle): string {
  const pad = (n: number | undefined | null) => String(n ?? 0).padStart(2, '0');

  const critical = c.criticalCount ?? 0;
  const major = c.majorCount ?? 0;
  const minor = c.minorCount ?? 0;
  const issues = c.issueCount ?? critical + major + minor;
  const remaining = c.remainingCount ?? 0;
  const failed = c.failedCount ?? 0;
  const blocked = c.blockedCount ?? 0;

  // ── Headline: "{Module}/{Feature} - {Platform} - {Cycle} V {Version} ({status})" ──
  const modFeat =
    c.moduleName && c.featureName
      ? `${c.moduleName}/${c.featureName}`
      : c.moduleName || c.featureName || c.name;

  // "Regression V 3.7.1" — strip any leading "v"/"V " the user typed so we don't double up.
  const versionClean = (c.version ?? '').replace(/^[vV]\s*/, '').trim();
  const categoryAndVersion = [c.cycleCategory ?? '', versionClean ? `V ${versionClean}` : '']
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ');

  const headlineParts = [modFeat, c.platform ?? '', categoryAndVersion]
    .map(s => s.trim())
    .filter(Boolean);
  const statusSuffix = (c.status ?? 'Active').toLowerCase();
  const headline = `${headlineParts.join(' - ')} (${statusSuffix})`;

  // ── Body status (independent of lifecycle status) ──
  const isFailed = issues > 0 || remaining > 0 || failed > 0 || blocked > 0;
  const slack = isFailed ? ':red_circle:' : ':large_green_circle:';
  const label = isFailed ? 'Failed' : 'Passed';

  const env = (c.environment ?? '').trim().toUpperCase() || '-';

  const lines: string[] = [];
  lines.push(headline);
  lines.push('');
  lines.push(`Environment: ${env}`);
  lines.push(`Status: ${slack} ${label}`);
  lines.push(`Total Issues Reported: ${pad(issues)}`);
  lines.push(`Severity:`);
  lines.push(`Critical: ${pad(critical)}`);
  lines.push(`Major: ${pad(major)}`);
  lines.push(`Minor: ${pad(minor)}`);

  return lines.join('\n');
}
