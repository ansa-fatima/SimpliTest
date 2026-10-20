'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { TestCycle, ApiTestRun, CycleSummary, RunResult, Module } from '@/types';
import { api } from '@/lib/client';
import { exportCycleResults } from '@/lib/export';
import { CycleReportModal } from './CycleReportModal';
import { UpdateQuickLogModal } from './QuickLogModal';
import { cn, priorityDisplay, relativeTime, resultTone, typeDisplay } from '@/lib/utils';
import { SIco } from '@/components/layout/sts-icons';
import { caseCode, priorityPillClass } from './tc-helpers';
import './sts-v3.css';
import { JiraTicketLink, useJiraSiteUrl } from '@/lib/jiraLink';
import type { JiraSubIssueInfo } from '@/lib/jira';

interface CycleViewProps {
  cycle: TestCycle;
  runs: ApiTestRun[];
  summary: CycleSummary | null;
  loading: boolean;
  modules?: Module[];
  projectId: string | null;
  projectName?: string;
  onBack: () => void;
  // `result` is a category KEY (see lib/options.ts) -- a built-in enum
  // literal or a custom RunResult WorkspaceOption.id.
  onSubmitResult: (runId: string, result: string, notes?: string) => Promise<void>;
  onCloseRun?: (cycleId: string) => void;
  onRegenerate?: (cycleId: string) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

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
  projectId,
  projectName,
  onBack,
  onSubmitResult,
  onCloseRun,
  onRegenerate,
  onUpdate,
  onDelete,
}: CycleViewProps) {
  const [filter, setFilter] = useState<FilterTab>('All');
  const [moduleFilter, setModuleFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [recurring, setRecurring] = useState<RecurringItem[] | null>(null);
  // Big runs (1,000+ cases) render in pages so the case list stays snappy.
  const [limit, setLimit] = useState(200);
  // Fetched once here and threaded down to the ticket pill, the Jira sync
  // panel, and the Summary/Report modals -- one fetch per screen instead of
  // each display spot re-checking the connection itself.
  const siteUrl = useJiraSiteUrl(projectId);
  // Loaded once for the whole runner so the status buttons never flicker while
  // moving between cases.
  const resultOptions = useRunResultOptions(projectId);

  // Same "failed here and failed/blocked in 2+ distinct cycles" rule as the
  // run detail screen -- fetched from the same endpoint so the two screens
  // can't disagree about what counts as recurring.
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

  // Open on the first case still waiting for a verdict (or the first failure
  // when everything is done) so the runner is immediately usable.
  useEffect(() => {
    if (selectedRunId) return;
    if (runs.length === 0) return;
    const firstPending = runs.find(r => r.result === 'NotRun' && !r.customResultId);
    const firstFail = runs.find(r => r.result === 'Failed');
    setSelectedRunId((firstPending ?? firstFail ?? runs[0]).id);
  }, [runs, selectedRunId]);

  const recurringIds = useMemo(() => new Set((recurring ?? []).map(r => r.id)), [recurring]);

  const moduleNames = useMemo(
    () => Array.from(new Set(runs.map(caseModuleName))).sort((a, b) => a.localeCompare(b)),
    [runs],
  );

  const filteredRuns = useMemo(() => {
    let list = runs;
    if (moduleFilter) list = list.filter(r => caseModuleName(r) === moduleFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        r =>
          r.testCase.title.toLowerCase().includes(q) ||
          String(r.testCase.caseNum).includes(q) ||
          caseCode(r.testCase.caseNum).toLowerCase().includes(q),
      );
    }
    if (filter === 'Recurring') return list.filter(r => recurringIds.has(r.testCaseId));
    if (filter === 'All') return list;
    // The built-in tabs only match built-in results -- a run with a custom
    // result (see lib/options.ts) shows under "All" but not under any of them.
    return list.filter(r => !r.customResultId && r.result === filter);
  }, [runs, moduleFilter, search, filter, recurringIds]);

  useEffect(() => {
    setLimit(200);
  }, [filter, moduleFilter, search]);

  const selectedRun = useMemo(
    () => runs.find(r => r.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  const total = summary?.total ?? runs.length;
  const counts = summary?.counts ?? { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
  const done = summary?.done ?? total - counts.NotRun;
  const percent = summary?.percent ?? (total === 0 ? 0 : Math.round((done / total) * 100));
  const passRate = done === 0 ? 0 : (counts.Passed / done) * 100;

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: 'All', label: 'All', count: runs.length },
    { key: 'NotRun', label: 'Pending', count: counts.NotRun },
    { key: 'Passed', label: 'Passed', count: counts.Passed },
    { key: 'Failed', label: 'Failed', count: counts.Failed },
    { key: 'Blocked', label: 'Blocked', count: counts.Blocked },
    { key: 'Recurring', label: 'Recurring', count: recurring?.length ?? 0 },
  ];

  const handleDelete = async () => {
    if (!window.confirm(`Delete this test run — "${cycle.name}"?\n\nThis cannot be undone.`))
      return;
    setDeleting(true);
    try {
      // The cycle being viewed no longer exists once deleted -- leave this
      // screen instead of staying on a dead record.
      await onDelete(cycle.id);
      onBack();
    } catch {
      setDeleting(false);
    }
  };

  // Move the selection by `delta` within the visible list.
  const go = (delta: number) => {
    if (filteredRuns.length === 0) return;
    const i = filteredRuns.findIndex(r => r.id === selectedRunId);
    const next = filteredRuns[Math.min(Math.max(i + delta, 0), filteredRuns.length - 1)];
    if (next) setSelectedRunId(next.id);
  };
  // After a verdict, jump to the next case that still needs one.
  const goNextPending = (fromId: string) => {
    const i = filteredRuns.findIndex(r => r.id === fromId);
    const after = filteredRuns.slice(i + 1).find(r => r.result === 'NotRun' && !r.customResultId);
    if (after) setSelectedRunId(after.id);
    else go(1);
  };

  const statusPill =
    cycle.status === 'Completed'
      ? { cls: 'pill-ok', label: 'Closed' }
      : cycle.status === 'Archived'
        ? { cls: 'pill-neutral', label: 'Archived' }
        : { cls: 'pill-info', label: 'Running' };

  return (
    <div className="stv3 run-wrap">
      <div className="run-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <SIco name="chevron-left" /> {projectName ? 'Test runs' : 'Back'}
        </button>
        <div className="run-bar-title">
          <span className="rb-name">{cycle.name}</span>
          <span className={cn('pill', statusPill.cls)}>
            <span className="dot" /> {statusPill.label}
          </span>
          {cycle.version && (
            <span className="pill pill-neutral">v{cycle.version.replace(/^v\s*/i, '')}</span>
          )}
          {cycle.cycleCategory && <span className="pill pill-neutral">{cycle.cycleCategory}</span>}
          {cycle.ticketLink && (
            <span className="pill pill-neutral">
              <JiraTicketLink
                ticketLink={cycle.ticketLink}
                siteUrl={cycle.jiraSiteUrl ?? siteUrl}
              />
            </span>
          )}
          {cycle.scopeName && <span className="rb-scope">Scope: {cycle.scopeName}</span>}
        </div>
        <div className="run-bar-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowReport(true)}
          >
            <SIco name="clipboard" /> Summary
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => exportCycleResults(cycle, runs)}
          >
            <SIco name="download" /> Export
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowEdit(true)}
          >
            <SIco name="edit" /> Edit
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ color: 'var(--err)' }}
            onClick={handleDelete}
            disabled={deleting}
          >
            <SIco name="trash" /> Delete
          </button>
          {onCloseRun && cycle.status === 'Active' && counts.NotRun === 0 && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (
                  confirm(
                    `Close run "${cycle.name}"? It will be marked Completed and become read-only.`,
                  )
                ) {
                  onCloseRun(cycle.id);
                }
              }}
            >
              <SIco name="check" /> Close run
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="state-note">Loading cases…</div>
      ) : runs.length === 0 ? (
        <div className="state-note" style={{ padding: 24 }}>
          <EmptyRunsRecovery
            scopeType={cycle.scopeType}
            onRegenerate={
              onRegenerate && cycle.scopeType !== 'Custom'
                ? () => onRegenerate(cycle.id)
                : undefined
            }
          />
        </div>
      ) : (
        <div className="run-shell">
          {/* Case list */}
          <div className="run-list">
            <div className="run-list-head">
              <div>
                <h4>
                  {done.toLocaleString()} / {total.toLocaleString()}
                </h4>
                <div style={{ fontSize: 11, color: 'var(--t-3)', fontFamily: 'var(--f-mono)' }}>
                  {passRate.toFixed(1)}% pass · {total === 0 ? 0 : 100 - percent}% remaining
                </div>
              </div>
              <div className="progress">
                <span className="progress-bar ok" style={{ width: `${percent}%` }} />
              </div>
            </div>
            <div
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid var(--bdr)',
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                background: 'var(--c-surface)',
              }}
            >
              {TABS.map(t => (
                <button
                  key={t.key}
                  type="button"
                  className={cn('fpill', filter === t.key && 'active')}
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => setFilter(t.key)}
                >
                  {t.label} <span className="count">{t.count}</span>
                </button>
              ))}
            </div>
            <div
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid var(--bdr)',
                display: 'flex',
                gap: 6,
                background: 'var(--c-surface)',
              }}
            >
              <input
                className="input"
                style={{ padding: '6px 10px', fontSize: 12 }}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search case ID or title…"
              />
              {moduleNames.length > 1 && (
                <select
                  className="select"
                  style={{ padding: '6px 26px 6px 10px', fontSize: 12, maxWidth: 130 }}
                  value={moduleFilter}
                  onChange={e => setModuleFilter(e.target.value)}
                  title="Filter by module"
                >
                  <option value="">All modules</option>
                  {moduleNames.map(n => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {filteredRuns.length === 0 ? (
              <div className="empty-note" style={{ padding: '32px 16px' }}>
                {filter === 'Recurring'
                  ? 'Nothing in this run has failed before.'
                  : 'No cases match this filter.'}
              </div>
            ) : (
              filteredRuns
                .slice(0, limit)
                .map(r => (
                  <RunCaseRow
                    key={r.id}
                    run={r}
                    active={r.id === selectedRunId}
                    onSelect={() => setSelectedRunId(r.id)}
                  />
                ))
            )}
            {filteredRuns.length > limit && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setLimit(l => l + 200)}
                >
                  Show {Math.min(200, filteredRuns.length - limit)} more ·{' '}
                  {(filteredRuns.length - limit).toLocaleString()} hidden
                </button>
              </div>
            )}
          </div>

          {/* Execution pane */}
          {selectedRun ? (
            <ExecPane
              key={selectedRun.id}
              run={selectedRun}
              cycle={cycle}
              projectId={projectId}
              siteUrl={siteUrl}
              options={resultOptions}
              recurring={recurringIds.has(selectedRun.testCaseId)}
              onUpdate={onUpdate}
              onSubmitResult={onSubmitResult}
              onPrev={() => go(-1)}
              onNext={() => go(1)}
              onAdvance={() => goNextPending(selectedRun.id)}
            />
          ) : (
            <div className="exec-pane">
              <div className="empty-note">Select a case to execute.</div>
            </div>
          )}
        </div>
      )}

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

// ─── Case list row ──────────────────────────────────────────

function resultVisual(run: ApiTestRun): {
  cls: string;
  icon: 'check' | 'x' | 'lock' | 'skip' | 'retry' | null;
} {
  if (run.customResultId) return { cls: 's-retest', icon: 'retry' };
  switch (run.result) {
    case 'Passed':
      return { cls: 's-pass', icon: 'check' };
    case 'Failed':
      return { cls: 's-fail', icon: 'x' };
    case 'Blocked':
      return { cls: 's-block', icon: 'lock' };
    case 'Skipped':
      return { cls: 's-skip', icon: 'skip' };
    default:
      return { cls: 's-pending', icon: null };
  }
}

const RCS_PATHS = {
  check: 'M2 6L5 9L10 3',
  x: 'M3 3l6 6M9 3l-6 6',
  lock: 'M3 8L8 3',
  skip: 'M3 6h6M9 6L7 4M9 6L7 8',
  retry: 'M2 6a4 4 0 018 0M10 6L8 8M10 6l-2-2',
} as const;

function shortAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function RunCaseRow({
  run,
  active,
  onSelect,
}: {
  run: ApiTestRun;
  active: boolean;
  onSelect: () => void;
}) {
  const v = resultVisual(run);
  const tc = run.testCase;
  const side = active ? (
    <span className="rc-side" style={{ color: 'var(--brand-700)', fontWeight: 600 }}>
      ▶ now
    </span>
  ) : run.executedAt ? (
    <span
      className="rc-side"
      style={{
        color:
          run.result === 'Failed'
            ? 'var(--err)'
            : run.result === 'Blocked'
              ? 'var(--warn)'
              : undefined,
      }}
    >
      {run.result === 'Failed'
        ? 'fail'
        : run.result === 'Blocked'
          ? 'blocked'
          : shortAgo(run.executedAt)}
    </span>
  ) : (
    <span className="rc-side" />
  );
  return (
    <div className={cn('run-case', active && 'active')} onClick={onSelect}>
      <span className={cn('rcs', v.cls)}>
        {v.icon && (
          <svg viewBox="0 0 12 12">
            <path d={RCS_PATHS[v.icon]} />
          </svg>
        )}
      </span>
      <div>
        <span className="rcid">{caseCode(tc.caseNum)}</span>
        <div className="rctitle">{tc.title}</div>
      </div>
      {side}
    </div>
  );
}

// ─── Execution pane ─────────────────────────────────────────

// Steps are stored as a JSON array of strings (older rows may hold a single
// newline-separated string or {action} objects) -- normalise to plain lines.
function stepLines(steps: unknown): string[] {
  const clean = (s: string) => s.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim();
  if (Array.isArray(steps)) {
    return steps
      .map(s =>
        typeof s === 'string'
          ? s
          : s && typeof s === 'object'
            ? String(
                (s as { action?: string; step?: string }).action ??
                  (s as { step?: string }).step ??
                  '',
              )
            : '',
      )
      .map(clean)
      .filter(Boolean);
  }
  if (typeof steps === 'string') return steps.split('\n').map(clean).filter(Boolean);
  return [];
}

function useElapsed(): string {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

type StepMark = 'pass' | 'fail';

function ExecPane({
  run,
  cycle,
  projectId,
  siteUrl,
  options,
  recurring,
  onUpdate,
  onSubmitResult,
  onPrev,
  onNext,
  onAdvance,
}: {
  run: ApiTestRun;
  cycle: TestCycle;
  projectId: string | null;
  siteUrl: string | null;
  options: RunResultOption[];
  recurring: boolean;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onSubmitResult: (runId: string, result: string, notes?: string) => Promise<void>;
  onPrev: () => void;
  onNext: () => void;
  onAdvance: () => void;
}) {
  const tc = run.testCase;
  const [notes, setNotes] = useState(run.notes);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [stepMarks, setStepMarks] = useState<Record<number, StepMark>>({});
  const [pre, setPre] = useState<Record<number, boolean>>({});
  const elapsed = useElapsed();
  // A finished run stays editable on purpose: retesting a failed case after a
  // fix is the normal workflow, and the API accepts results on a Completed run.
  const readOnly = false;

  const steps = stepLines(tc.steps);
  const preconditions = (tc.preconditions ?? '')
    .split('\n')
    .map(s => s.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean);
  const stepsDone = Object.keys(stepMarks).length;
  const currentKey = run.customResultId ?? run.result;

  const submit = async (key: string, advance = false) => {
    if (readOnly || saving) return;
    setSaving(key);
    try {
      await onSubmitResult(run.id, key, notes);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      if (advance) onAdvance();
    } finally {
      setSaving(null);
    }
  };

  // P / F / ← / → / ⌘S, ignored while typing in a field.
  const latest = useRef({ submit, onPrev, onNext, currentKey });
  latest.current = { submit, onPrev, onNext, currentKey };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        latest.current.submit(latest.current.currentKey);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p') latest.current.submit('Passed', true);
      else if (k === 'f') latest.current.submit('Failed');
      else if (e.key === 'ArrowLeft') latest.current.onPrev();
      else if (e.key === 'ArrowRight') latest.current.onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pri = priorityDisplay(tc);
  const typ = typeDisplay(tc);
  const sbtnFor = (o: RunResultOption) => {
    const map: Record<string, { cls: string; icon: React.ReactNode; kbd?: string }> = {
      Passed: { cls: 's-pass', icon: <SIco name="check" />, kbd: 'P' },
      Failed: { cls: 's-fail', icon: <SIco name="fail" />, kbd: 'F' },
      Blocked: { cls: 's-block', icon: <SIco name="lock" /> },
      Skipped: { cls: 's-skip', icon: <SIco name="skip" /> },
    };
    return map[o.key] ?? { cls: 's-retest', icon: <SIco name="retry" /> };
  };
  const label = (o: RunResultOption) =>
    o.key === 'Passed'
      ? 'Pass'
      : o.key === 'Failed'
        ? 'Fail'
        : o.key === 'Blocked'
          ? 'Block'
          : o.key === 'Skipped'
            ? 'Skip'
            : o.name;

  return (
    <div className="exec-pane">
      {cycle.ticketLink && (
        <JiraSyncPanel cycle={cycle} projectId={projectId} siteUrl={siteUrl} onUpdate={onUpdate} />
      )}

      <div className="exec-head">
        <div className="exec-id">
          {caseCode(tc.caseNum)} · {caseScopePath(run)}
        </div>
        <div className="exec-title">{tc.title}</div>
        <div className="exec-meta">
          <span style={{ color: 'var(--brand-700)', fontWeight: 500 }}>
            <SIco name="clock" size={12} /> {elapsed} elapsed
          </span>
          <span
            className={cn('pill', priorityPillClass(pri.label))}
            style={{ padding: '1px 8px', fontSize: 11 }}
          >
            {pri.label}
          </span>
          <span className="pill pill-neutral" style={{ padding: '1px 8px', fontSize: 11 }}>
            {typ.label}
          </span>
          {tc.owner && (
            <span>
              <SIco name="users" size={12} /> Assigned to{' '}
              <b style={{ color: 'var(--t-2)' }}>{tc.owner.name || tc.owner.username}</b>
            </span>
          )}
          {recurring && (
            <span style={{ color: 'var(--err)', fontWeight: 500 }}>
              <SIco name="retry" size={12} /> Recurring failure
            </span>
          )}
          {run.executedAt && (
            <span>
              Last result {timeAgo(run.executedAt)}
              {run.executedBy ? ` by ${run.executedBy}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="exec-status">
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--t-2)',
            textTransform: 'uppercase',
            letterSpacing: '.05em',
          }}
        >
          Set status
        </span>
        <div className="status-row">
          {options
            .filter(o => o.key !== 'NotRun')
            .map(o => {
              const v = sbtnFor(o);
              return (
                <button
                  key={o.key}
                  type="button"
                  disabled={readOnly || saving !== null}
                  className={cn('sbtn', v.cls, currentKey === o.key && 'active')}
                  onClick={() => submit(o.key, o.key === 'Passed')}
                >
                  {v.icon} {saving === o.key ? 'Saving…' : label(o)}
                  {v.kbd && (
                    <span
                      className="kbd"
                      style={{
                        background: v.cls === 's-pass' ? 'var(--ok-bg)' : 'var(--err-bg)',
                        color: v.cls === 's-pass' ? 'var(--ok)' : 'var(--err)',
                        borderColor: v.cls === 's-pass' ? 'var(--ok-bdr)' : 'var(--err-bdr)',
                      }}
                    >
                      {v.kbd}
                    </span>
                  )}
                </button>
              );
            })}
          {!readOnly && currentKey !== 'NotRun' && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={saving !== null}
              onClick={() => submit('NotRun')}
            >
              Reset
            </button>
          )}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button type="button" className="icon-btn" title="Previous (←)" onClick={onPrev}>
            <SIco name="chevron-left" />
          </button>
          <button type="button" className="icon-btn" title="Next (→)" onClick={onNext}>
            <SIco name="chevron-right" />
          </button>
        </div>
      </div>

      {preconditions.length > 0 && (
        <div className="exec-block">
          <div className="exec-block-head">
            <span>
              Preconditions
              <span className="sub">
                {preconditions.length} condition{preconditions.length === 1 ? '' : 's'}
              </span>
            </span>
          </div>
          <div className="exec-block-body" style={{ fontSize: 13, color: 'var(--t-2)' }}>
            {preconditions.map((p, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  marginBottom: i < preconditions.length - 1 ? 6 : 0,
                  cursor: 'pointer',
                }}
                onClick={() => setPre(m => ({ ...m, [i]: !m[i] }))}
              >
                <span className={cn('cb', pre[i] && 'on')} style={{ marginTop: 2 }}>
                  <svg viewBox="0 0 12 12">
                    <path d="M2 6L5 9L10 3" />
                  </svg>
                </span>
                {p}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="exec-block">
        <div className="exec-block-head">
          <span>
            Steps
            <span className="sub">
              tick steps as you go — the case status above is what&apos;s saved
            </span>
          </span>
          {steps.length > 0 && (
            <span
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                color: 'var(--t-3)',
                textTransform: 'none',
                letterSpacing: 0,
              }}
            >
              {stepsDone} / {steps.length} done
            </span>
          )}
        </div>
        <div className="exec-block-body">
          {steps.length === 0 ? (
            <div style={{ color: 'var(--t-3)', fontSize: 13 }}>
              This case has no steps recorded.
            </div>
          ) : (
            <ol className="steps-list">
              {steps.map((s, i) => (
                <li
                  key={i}
                  className={cn(
                    stepMarks[i] === 'pass' && 'done',
                    stepMarks[i] === 'fail' && 'fail',
                  )}
                >
                  <div className="step-content">
                    <div className="step-action">{s}</div>
                    <div className="step-status">
                      <button
                        type="button"
                        className={cn('sbtn s-pass', stepMarks[i] === 'pass' && 'active')}
                        onClick={() =>
                          setStepMarks(m => {
                            const n = { ...m };
                            if (n[i] === 'pass') delete n[i];
                            else n[i] = 'pass';
                            return n;
                          })
                        }
                      >
                        <SIco name="check" /> Pass
                      </button>
                      <button
                        type="button"
                        className={cn('sbtn s-fail', stepMarks[i] === 'fail' && 'active')}
                        onClick={() =>
                          setStepMarks(m => {
                            const n = { ...m };
                            if (n[i] === 'fail') delete n[i];
                            else n[i] = 'fail';
                            return n;
                          })
                        }
                      >
                        <SIco name="fail" /> Fail
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {tc.expected && (
            <div
              className="step-expected"
              style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--bdr)' }}
            >
              <b>Expected result:</b> {tc.expected}
            </div>
          )}
        </div>
      </div>

      {recurring && (
        <div className="exec-block">
          <div className="exec-block-head">
            <span>History across runs</span>
          </div>
          <div className="exec-block-body">
            <RecurringHistoryPanel testCaseId={run.testCaseId} />
          </div>
        </div>
      )}

      <div className="exec-block">
        <div className="exec-block-head">
          <span>
            Tester notes &amp; evidence
            <span className="sub">add a note when you Fail or Block a case</span>
          </span>
          {saved && (
            <span style={{ color: 'var(--ok)', textTransform: 'none', letterSpacing: 0 }}>
              Saved ✓
            </span>
          )}
        </div>
        <div className="exec-block-body">
          <textarea
            className="textarea"
            value={notes}
            readOnly={readOnly}
            onChange={e => setNotes(e.target.value)}
            placeholder={
              readOnly
                ? 'Run is closed — notes are read-only.'
                : 'Note any anomalies, environment specifics, or observations…'
            }
          />
          <div className="dropzone" style={{ marginTop: 10, padding: 14, opacity: 0.7 }}>
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
            >
              <span style={{ color: 'var(--brand-700)', display: 'inline-flex' }}>
                <SIco name="upload" size={18} />
              </span>
              <span style={{ fontSize: 13 }}>
                <b>Screenshots, video or logs</b> · evidence upload is coming soon
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 12,
          color: 'var(--t-3)',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span>
          Keyboard: <span className="kbd-light">P</span> Pass · <span className="kbd-light">F</span>{' '}
          Fail · <span className="kbd-light">←</span>
          <span className="kbd-light">→</span> Navigate · <span className="kbd-light">⌘ S</span>{' '}
          Save note
        </span>
        {!readOnly && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving !== null}
            onClick={() => submit('Passed', true)}
          >
            <SIco name="check" /> Mark Pass &amp; next
          </button>
        )}
      </div>
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
