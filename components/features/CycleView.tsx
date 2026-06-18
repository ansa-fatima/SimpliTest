'use client';

import { useEffect, useMemo, useState } from 'react';
import { TestCycle, ApiTestRun, CycleSummary, RunResult } from '@/types';
import { exportCycleResults } from '@/lib/export';
import { CycleReportModal } from './CycleReportModal';
import { avatarColour, cn, initials, priorityBadge, severityBadge, typeBadge } from '@/lib/utils';

interface CycleViewProps {
  cycle: TestCycle;
  runs: ApiTestRun[];
  summary: CycleSummary | null;
  loading: boolean;
  onBack: () => void;
  onSubmitResult: (runId: string, result: RunResult, notes?: string) => Promise<void>;
  onCloseRun?: (cycleId: string) => void;
  onRegenerate?: (cycleId: string) => void;
}

const RESULTS: RunResult[] = ['Passed', 'Failed', 'Blocked', 'Skipped'];

const RESULT_BTN: Record<RunResult, string> = {
  NotRun: 'border-border text-text-3 hover:bg-surface-2',
  Passed: 'border-green-300 text-green-700 hover:bg-green-50',
  Failed: 'border-red-300 text-red-700 hover:bg-red-50',
  Blocked: 'border-amber-300 text-amber-700 hover:bg-amber-50',
  Skipped: 'border-slate-300 text-slate-600 hover:bg-slate-50',
};

export function CycleView({
  cycle,
  runs,
  summary,
  loading,
  onBack,
  onSubmitResult,
  onCloseRun,
  onRegenerate,
}: CycleViewProps) {
  const [filter, setFilter] = useState<RunResult | 'All'>('All');
  const [showReport, setShowReport] = useState(false);
  // Track which run row is selected (drives the right-side panel).
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Default-select first failed run so the failure panel is visible on open (matches design).
  useEffect(() => {
    if (selectedRunId) return;
    if (runs.length === 0) return;
    const firstFail = runs.find(r => r.result === 'Failed');
    setSelectedRunId(firstFail?.id ?? runs[0].id);
  }, [runs, selectedRunId]);

  const filteredRuns = useMemo(
    () => (filter === 'All' ? runs : runs.filter(r => r.result === filter)),
    [filter, runs],
  );
  const selectedRun = useMemo(
    () => runs.find(r => r.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  const total = summary?.total ?? runs.length;
  const counts = summary?.counts ?? { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
  const done = summary?.done ?? total - counts.NotRun;
  const percent = summary?.percent ?? (total === 0 ? 0 : Math.round((done / total) * 100));

  // Distinct executor names → avatar stack (max 3 + “+N”).
  const executors = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const r of runs) {
      const name = (r.executedBy || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      list.push(name);
    }
    return list;
  }, [runs]);

  const subtitle = buildSubtitle(cycle, total);
  const statusTone =
    cycle.status === 'Active'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : cycle.status === 'Completed'
        ? 'bg-blue-50 text-blue-700 ring-blue-200'
        : 'bg-amber-50 text-amber-700 ring-amber-200';

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Breadcrumb — surfaces the Portal / Module / Feature scope so the user
            can see at a glance what this run is targeting. */}
        <div className="mb-2 flex items-center gap-1.5 text-[12px] text-text-3">
          <button onClick={onBack} className="hover:text-text">
            Test runs
          </button>
          <span className="text-text-3">/</span>
          <span className="font-medium text-text">{shortRunCode(cycle)}</span>
          {(() => {
            const segments = cycleScopeSegments(cycle);
            if (segments.length === 0) return null;
            return (
              <>
                <span className="text-text-3">·</span>
                {segments.map((seg, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5">
                    {i > 0 && <span className="text-text-3">›</span>}
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-2">
                      {seg}
                    </span>
                  </span>
                ))}
              </>
            );
          })()}
        </div>

        {/* Header strip */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] text-text">
                {cycle.name}
              </h1>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1',
                  statusTone,
                )}
              >
                {cycle.status}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-text-2">{subtitle}</p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-3">
            {executors.length > 0 && (
              <div className="flex -space-x-1.5">
                {executors.slice(0, 3).map(name => (
                  <span
                    key={name}
                    title={name}
                    className={cn(
                      'inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-surface',
                      avatarColour(name),
                    )}
                  >
                    {initials(name)}
                  </span>
                ))}
                {executors.length > 3 && (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-text-2 ring-2 ring-surface">
                    +{executors.length - 3}
                  </span>
                )}
              </div>
            )}
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
            {onCloseRun && cycle.status === 'Active' && (
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

        {/* Progress widget */}
        <div className="mb-5 rounded-lg border border-border bg-surface px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[13px] font-semibold text-text">Progress</div>
            <div className="text-[13px] text-text-2">
              <span className="font-semibold text-text">
                {done} of {total}
              </span>{' '}
              · {percent}% complete
            </div>
          </div>
          <SegmentedProgressBar counts={counts} total={total} height={10} />
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
            <LegendDot
              color="bg-emerald-500"
              label="passed"
              value={counts.Passed}
              valueClass="text-emerald-700"
            />
            <LegendDot
              color="bg-red-500"
              label="failed"
              value={counts.Failed}
              valueClass="text-red-700"
            />
            <LegendDot
              color="bg-amber-500"
              label="blocked"
              value={counts.Blocked}
              valueClass="text-amber-700"
            />
            <LegendDot
              color="bg-slate-400"
              label="skipped"
              value={counts.Skipped}
              valueClass="text-slate-700"
            />
            <LegendDot
              color="bg-slate-200"
              label="remaining"
              value={counts.NotRun}
              valueClass="text-slate-500"
            />
          </div>
        </div>

        {/* Two-column body */}
        <div className="flex items-start gap-5">
          {/* LEFT — filter chips + run list */}
          <section className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {(['All', 'NotRun', 'Passed', 'Failed', 'Blocked', 'Skipped'] as const).map(r => {
                const c = r === 'All' ? runs.length : (counts[r as RunResult] ?? 0);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setFilter(r)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors',
                      filter === r
                        ? 'bg-primary text-white shadow-sm'
                        : 'border border-border bg-surface text-text-2 hover:bg-surface-2',
                    )}
                  >
                    {r === 'NotRun' ? 'Not run' : r}
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-[10px]',
                        filter === r ? 'bg-white/20' : 'bg-surface-2 text-text-3',
                      )}
                    >
                      {c}
                    </span>
                  </button>
                );
              })}
            </div>

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
                  title="No runs match this filter"
                  body="Try the All tab."
                />
              )
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="bg-surface-2">
                    <tr>
                      <th className="w-[36px] border-b border-border px-2 py-2.5" />
                      <th className="w-[100px] border-b border-border px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-text-3">
                        ID
                      </th>
                      <th className="border-b border-border px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-text-3">
                        Title
                      </th>
                      <th className="w-[180px] border-b border-border px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-[0.04em] text-text-3">
                        Result
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRuns.map(run => {
                      const isSel = run.id === selectedRunId;
                      return (
                        <tr
                          key={run.id}
                          onClick={() => setSelectedRunId(run.id)}
                          className={cn(
                            'cursor-pointer border-b border-border transition-colors last:border-b-0',
                            isSel ? 'bg-primary-light/70' : 'hover:bg-surface-2',
                          )}
                        >
                          <td className="px-2 py-3 text-center">
                            <ResultGlyph result={run.result} />
                          </td>
                          <td className="px-4 py-3 font-mono text-[12px] text-text-3">
                            TC-{String(run.testCase.caseNum).padStart(2, '0')}
                          </td>
                          <td className="px-4 py-3">
                            <span className="block max-w-[420px] truncate font-medium text-text">
                              {run.testCase.title}
                            </span>
                            <span className="block max-w-[420px] truncate text-[11px] text-text-3">
                              {run.testCase.feature?.module.name} · {run.testCase.feature?.name}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <ResultChip run={run} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* RIGHT — selected-case detail panel */}
          {selectedRun && (
            <SelectedCasePanel
              key={selectedRun.id}
              run={selectedRun}
              readOnly={cycle.status !== 'Active'}
              onSubmitResult={onSubmitResult}
            />
          )}
        </div>
      </div>

      {/* Summary modal — preserved */}
      {showReport && <CycleReportModal cycleId={cycle.id} onClose={() => setShowReport(false)} />}
    </div>
  );
}

// ─── Selected case right-side panel ──────────────────────────

function SelectedCasePanel({
  run,
  readOnly,
  onSubmitResult,
}: {
  run: ApiTestRun;
  readOnly: boolean;
  onSubmitResult: (runId: string, result: RunResult, notes?: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState(run.notes);
  const [saving, setSaving] = useState<RunResult | null>(null);
  const [savedNotes, setSavedNotes] = useState(false);
  const tc = run.testCase;

  // Reset local notes when the selected run changes.
  useEffect(() => {
    setNotes(run.notes);
  }, [run.id, run.notes]);

  const tone =
    run.result === 'Passed'
      ? 'border-emerald-300 ring-emerald-100'
      : run.result === 'Failed'
        ? 'border-red-300 ring-red-100'
        : run.result === 'Blocked'
          ? 'border-amber-300 ring-amber-100'
          : run.result === 'Skipped'
            ? 'border-slate-300 ring-slate-100'
            : 'border-border ring-surface-2';

  const labelTone =
    run.result === 'Passed'
      ? 'text-emerald-700'
      : run.result === 'Failed'
        ? 'text-red-700'
        : run.result === 'Blocked'
          ? 'text-amber-700'
          : run.result === 'Skipped'
            ? 'text-slate-600'
            : 'text-text-3';

  const submit = async (result: RunResult) => {
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
          Selected · {run.result === 'NotRun' ? 'Not run' : run.result}
        </div>
        <div className="font-mono text-[11px] text-text-3">
          TC-{String(tc.caseNum).padStart(2, '0')}
        </div>
        <h3 className="mt-0.5 text-[14px] font-semibold leading-snug text-text">{tc.title}</h3>
        <p className="mt-1 text-[11px] text-text-3">
          {tc.feature?.module.name} · {tc.feature?.name}
        </p>

        <div className="mt-2 flex flex-wrap gap-1">
          <Pill className={priorityBadge(tc.priority)}>{tc.priority}</Pill>
          <Pill className={severityBadge(tc.severity)}>{tc.severity}</Pill>
          <Pill className={typeBadge(tc.type)}>{tc.type}</Pill>
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
            {RESULTS.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => submit(r)}
                disabled={saving !== null}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  RESULT_BTN[r],
                  run.result === r && 'ring-2 ring-primary-light',
                )}
              >
                {saving === r ? 'Saving…' : r}
              </button>
            ))}
          </div>
          {run.result !== 'NotRun' && (
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

function ResultGlyph({ result }: { result: RunResult }) {
  if (result === 'Passed')
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <i className="ti ti-check text-[12px]" />
      </span>
    );
  if (result === 'Failed')
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-700">
        <i className="ti ti-x text-[12px]" />
      </span>
    );
  if (result === 'Blocked')
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <i className="ti ti-player-pause text-[12px]" />
      </span>
    );
  if (result === 'Skipped')
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-slate-600">
        <i className="ti ti-player-skip-forward text-[12px]" />
      </span>
    );
  return (
    <span className="inline-block h-3.5 w-3.5 rounded-full border-[1.5px] border-border-strong" />
  );
}

function ResultChip({ run }: { run: ApiTestRun }) {
  if (run.result === 'NotRun') {
    return <span className="text-[12px] text-text-3">—</span>;
  }
  const baseColor =
    run.result === 'Passed'
      ? 'text-emerald-700'
      : run.result === 'Failed'
        ? 'text-red-700'
        : run.result === 'Blocked'
          ? 'text-amber-700'
          : 'text-slate-600';
  const symbol =
    run.result === 'Passed'
      ? '✓'
      : run.result === 'Failed'
        ? '✗'
        : run.result === 'Blocked'
          ? '‖'
          : '↷';
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12.5px] font-medium', baseColor)}>
      <span>{symbol}</span>
      <span>{run.result}</span>
      {run.executedAt && <span className="text-text-3">· {timeAgo(run.executedAt)}</span>}
    </span>
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

function LegendDot({
  color,
  label,
  value,
  valueClass,
}: {
  color: string;
  label: string;
  value: number;
  valueClass?: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-text-2">
      <span className={cn('inline-block h-2 w-2 rounded-full', color)} />
      <span className={cn('font-semibold', valueClass)}>{value}</span>
      <span>{label}</span>
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

// Returns the Portal / Module / Feature segments worth surfacing in the breadcrumb.
// CaseBased cycles derive these from scopeType + scopeName ("Portal" → just the name;
// "Module" → portal info isn't carried, so we just show the module; "Suite" →
// scopeName already encodes "ModuleName / SuiteName"). Manual cycles use the
// free-text portalName / moduleName / featureName entered at quick-log time.
function cycleScopeSegments(cycle: TestCycle): string[] {
  const isManual = (cycle.mode ?? 'CaseBased') === 'Manual';
  if (isManual) {
    return [cycle.portalName, cycle.moduleName, cycle.featureName].filter(
      (s): s is string => !!s && s.trim().length > 0,
    );
  }
  if (cycle.scopeType === 'Portal' && cycle.scopeName) return [cycle.scopeName];
  if (cycle.scopeType === 'Module' && cycle.scopeName) return [cycle.scopeName];
  if (cycle.scopeType === 'Suite' && cycle.scopeName) {
    // "Module / Suite" — split for breadcrumb display
    return cycle.scopeName.split(' / ').filter(Boolean);
  }
  return [];
}

function buildSubtitle(cycle: TestCycle, total: number): string {
  const parts: string[] = [];
  parts.push(`${total} case${total === 1 ? '' : 's'}`);
  parts.push(`started ${timeAgo(cycle.createdAt)}`);
  if (cycle.targetDate) parts.push(`due ${dueLabel(cycle.targetDate)}`);
  if (cycle.scopeName) parts.push(cycle.scopeName);
  // Run context (only added if set)
  if (cycle.environment) parts.push(cycle.environment.toUpperCase());
  if (cycle.platform) parts.push(cycle.platform);
  if (cycle.version) parts.push(`v${cycle.version.replace(/^v\s*/i, '')}`);
  return parts.join(' · ');
}

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

function dueLabel(iso: string): string {
  const due = new Date(iso);
  const now = new Date();
  const sameDay = due.toDateString() === now.toDateString();
  if (sameDay) return 'today';
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (due.toDateString() === tomorrow.toDateString()) return 'tomorrow';
  return due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function shortRunCode(cycle: TestCycle): string {
  const d = new Date(cycle.createdAt);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `R-${y}-${m}-${day}`;
}
