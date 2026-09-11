'use client';

import { useState } from 'react';
import { TestCycle, Module } from '@/types';
import { pointFromQuickLog } from '@/lib/stability';
import { avatarColour, cn, initials, localDateStr } from '@/lib/utils';
import { NewCycleModal, CycleFormPayload } from './NewCycleModal';

interface TestRunsBoardProps {
  cycles: TestCycle[];
  loading: boolean;
  modules: Module[];
  projectId: string | null;
  onOpenOverview: (id: string) => void;
  onCreate: (input: CycleFormPayload) => Promise<void>;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
}

type BoardTab = 'all' | 'inprogress' | 'planned' | 'completed';
type MainTab = 'runs' | 'quicklogs';

// A cycle named "Sanity Cycle 15" gets a short "C15" code -- same derivation
// as the Test Cycles table, so the two screens read consistently.
function cycleCode(name: string): string | null {
  const m = name.match(/(\d+)\s*$/);
  return m ? `C${m[1]}` : null;
}

// "Planned" isn't a real DB status -- it's an Active cycle nobody has
// started executing yet (0 runs touched). Once at least one run has a
// verdict, it reads as "In Progress" instead.
function isStarted(c: TestCycle): boolean {
  return (c.summary?.done ?? 0) > 0;
}

function statusTone(c: TestCycle): { label: string; dot: string; text: string } {
  if (c.status === 'Completed')
    return { label: 'Completed', dot: 'bg-success', text: 'text-success' };
  if (c.status === 'Archived') return { label: 'Archived', dot: 'bg-text-3', text: 'text-text-3' };
  return isStarted(c)
    ? { label: 'In Progress', dot: 'bg-primary', text: 'text-primary-text' }
    : { label: 'Planned', dot: 'bg-text-3', text: 'text-text-2' };
}

// The day-to-day working view -- resume an in-flight cycle or log a quick
// aggregate result, both at a glance. The full sheet with every column
// (version, ticket, per-severity breakdown, ...) lives at Test Cycles;
// this board is deliberately just "what's active, what to do next".
export function TestRunsBoard({
  cycles,
  loading,
  modules,
  projectId,
  onOpenOverview,
  onCreate,
  onUpdate,
}: TestRunsBoardProps) {
  const [mainTab, setMainTab] = useState<MainTab>('runs');
  const [tab, setTab] = useState<BoardTab>('all');
  const [createMode, setCreateMode] = useState<'CaseBased' | 'Manual' | null>(null);
  const [editingLog, setEditingLog] = useState<TestCycle | null>(null);

  const caseBased = cycles.filter(
    c => (c.mode ?? 'CaseBased') === 'CaseBased' && c.status !== 'Archived',
  );
  const quickLogs = [...cycles]
    .filter(c => (c.mode ?? 'CaseBased') === 'Manual')
    .sort(
      (a, b) =>
        new Date(b.completedAt ?? b.createdAt).getTime() -
        new Date(a.completedAt ?? a.createdAt).getTime(),
    );

  const inProgress = caseBased.filter(c => c.status === 'Active' && isStarted(c));
  const planned = caseBased.filter(c => c.status === 'Active' && !isStarted(c));
  const completed = caseBased.filter(c => c.status === 'Completed');

  const visible =
    tab === 'inprogress'
      ? inProgress
      : tab === 'planned'
        ? planned
        : tab === 'completed'
          ? completed
          : caseBased;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">
              Test Runs
            </h1>
            <p className="text-[13px] text-text-2">
              Two speeds of testing — resume a case-based cycle, or log a 30-second quick log.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateMode(mainTab === 'runs' ? 'CaseBased' : 'Manual')}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-[7px] text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover"
          >
            <i className="ti ti-plus text-[15px]" />
            {mainTab === 'runs' ? 'Add Test Run' : 'Quick Log'}
          </button>
        </div>

        {/* Runs / Quick Logs */}
        <div className="mb-4 flex items-center gap-5 border-b border-border">
          <MainTabButton
            active={mainTab === 'runs'}
            onClick={() => setMainTab('runs')}
            label="Runs"
            count={caseBased.length}
          />
          <MainTabButton
            active={mainTab === 'quicklogs'}
            onClick={() => setMainTab('quicklogs')}
            label="Quick Logs"
            count={quickLogs.length}
          />
        </div>

        {mainTab === 'runs' ? (
          <>
            {/* Sub-tabs */}
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <BoardTabButton
                active={tab === 'all'}
                onClick={() => setTab('all')}
                label="All"
                count={caseBased.length}
              />
              <BoardTabButton
                active={tab === 'inprogress'}
                onClick={() => setTab('inprogress')}
                label="In Progress"
                count={inProgress.length}
              />
              <BoardTabButton
                active={tab === 'planned'}
                onClick={() => setTab('planned')}
                label="Planned"
                count={planned.length}
              />
              <BoardTabButton
                active={tab === 'completed'}
                onClick={() => setTab('completed')}
                label="Completed"
                count={completed.length}
              />
            </div>

            {/* Cards */}
            {loading ? (
              <div className="flex items-center justify-center py-16 text-[13px] text-text-3">
                Loading…
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface py-14 text-text-3">
                <i className="ti ti-list-check text-[28px] opacity-50" />
                <p className="text-[13px]">No cycles in this view.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {visible.map(c => (
                  <RunCard key={c.id} cycle={c} onOpen={() => onOpenOverview(c.id)} />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mb-3 text-[12px] text-text-3">
              Lightweight aggregate logs. Retesting edits Done/Remaining on the same record —
              nothing new is created.
            </p>
            {quickLogs.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-[12.5px] text-text-3">
                No quick logs yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {quickLogs.map(log => (
                  <QuickLogRow key={log.id} log={log} onEdit={() => setEditingLog(log)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

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

      {editingLog && (
        <NewCycleModal
          modules={modules}
          projectId={projectId}
          initial={editingLog}
          onClose={() => setEditingLog(null)}
          onSave={async input => {
            const patch: Record<string, unknown> = { ...input };
            await onUpdate(editingLog.id, patch);
            setEditingLog(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Cards ──────────────────────────────────────────────────

function MainTabButton({
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
        'relative inline-flex items-center gap-1.5 px-1 pb-2.5 text-[13.5px] font-medium transition-colors',
        active ? 'text-text' : 'text-text-3 hover:text-text-2',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-px text-[10.5px]',
          active ? 'bg-primary-light text-primary-text' : 'bg-surface-2 text-text-3',
        )}
      >
        {count}
      </span>
      {active && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-primary" />}
    </button>
  );
}

function BoardTabButton({
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
          ? 'bg-primary-light font-semibold text-primary-text'
          : 'text-text-2 hover:bg-surface-2',
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

function RunCard({ cycle, onOpen }: { cycle: TestCycle; onOpen: () => void }) {
  const summary = cycle.summary;
  const total = summary?.total ?? 0;
  const done = summary?.done ?? 0;
  const percent = summary?.percent ?? 0;
  const passed = summary?.counts.Passed ?? 0;
  const failed = summary?.counts.Failed ?? 0;
  const blocked = summary?.counts.Blocked ?? 0;
  const isActive = cycle.status === 'Active';
  const code = cycleCode(cycle.name);
  const status = statusTone(cycle);
  const scopeBits = [
    cycle.scopeName,
    cycle.version ? `v${cycle.version.replace(/^v\s*/i, '')}` : null,
    cycle.environment,
  ].filter(Boolean);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text">{cycle.name}</p>
          <p className="truncate text-[11px] text-text-3">
            {code && `${code} · `}
            {scopeBits.join(' · ')}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex flex-shrink-0 items-center gap-1.5 text-[11px] font-medium',
            status.text,
          )}
        >
          <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', status.dot)} />
          {status.label}
        </span>
      </div>

      <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-text-3">
        <span>
          {done} / {total} executed
        </span>
        <span className="font-semibold text-text">{percent}%</span>
      </div>
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>

      <div className="mb-3 flex items-center justify-between text-[11.5px]">
        <span className="flex items-center gap-2.5">
          <span className="text-success">{passed} passed</span>
          <span className="text-danger">{failed} failed</span>
          <span className="text-warning">{blocked} blocked</span>
        </span>
        {cycle.tester && (
          <span
            title={cycle.tester}
            className={cn(
              'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
              avatarColour(cycle.tester),
            )}
          >
            {initials(cycle.tester)}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'mt-auto inline-flex items-center justify-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition-colors',
          isActive
            ? 'bg-primary text-white hover:bg-primary-hover'
            : 'border border-border bg-surface text-text hover:bg-surface-2',
        )}
      >
        <i className="ti ti-player-play text-[14px]" />
        {isActive ? 'Resume Execution' : 'View Results'}
      </button>
    </div>
  );
}

// ─── Quick Logs list ────────────────────────────────────────

function QuickLogRow({ log, onEdit }: { log: TestCycle; onEdit: () => void }) {
  const point = pointFromQuickLog({
    id: log.id,
    name: log.name,
    issueCount: log.issueCount ?? 0,
    doneCount: log.doneCount ?? 0,
    remainingCount: log.remainingCount ?? 0,
    failedCount: log.failedCount ?? 0,
    blockedCount: log.blockedCount ?? 0,
    completedAt: log.completedAt ? new Date(log.completedAt) : null,
    createdAt: new Date(log.createdAt),
  });
  const code = `QL-${log.id.slice(-4).toUpperCase()}`;
  const scopePath =
    [log.moduleName, log.featureName].filter(Boolean).join(' → ') || log.portalName || 'Unscoped';
  const tags = [
    log.cycleCategory,
    log.environment,
    log.platform,
    log.version ? `v${log.version.replace(/^v\s*/i, '')}` : null,
  ].filter((t): t is string => !!t);

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0 font-mono text-[11px] text-text-3">{code}</span>
          <span className="truncate text-[13px] font-medium text-text">{scopePath}</span>
        </div>
        {(tags.length > 0 || log.ticketLink) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {tags.map((t, i) => (
              <span
                key={i}
                className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] text-text-2"
              >
                {t}
              </span>
            ))}
            {log.ticketLink && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] text-text-2">
                <i className="ti ti-brand-jira text-[11px] text-text-3" />
                {log.ticketLink.replace(/^https?:\/\//, '')}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 text-right">
        <p
          className={cn('text-[12.5px] font-semibold', point.pass ? 'text-success' : 'text-danger')}
        >
          {point.detail}
        </p>
        <p className="text-[11px] text-text-3">
          by {log.loggedBy || 'Unattributed'} ·{' '}
          {localDateStr(new Date(log.completedAt ?? log.createdAt))}
        </p>
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-2"
      >
        <i className="ti ti-refresh text-[13px]" />
        Reopen / Update
      </button>
    </div>
  );
}
