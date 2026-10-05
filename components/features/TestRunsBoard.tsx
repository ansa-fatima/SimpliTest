'use client';

import { useMemo, useState } from 'react';
import { TestCycle, Module } from '@/types';
import { avatarColour, cn, initials, localDateStr } from '@/lib/utils';
import { deriveOutcome, CycleOutcome } from '@/lib/cycleOutcome';
import { exportCycles } from '@/lib/export';
import { NewCycleModal, CycleFormPayload } from './NewCycleModal';
import { UpdateQuickLogModal } from './QuickLogModal';
import { CycleFormPanel } from './CycleFormPanel';
import { ImportCyclesModal } from './ImportCyclesModal';
import { CycleInfoModal } from './CycleInfoModal';
import { JiraTicketLink, useJiraSiteUrl } from '@/lib/jiraLink';

interface TestRunsBoardProps {
  cycles: TestCycle[];
  loading: boolean;
  modules: Module[];
  projectId: string | null;
  /** Session user, used to default the QA Engineer field on a new cycle. */
  currentUserName?: string;
  // Goes straight to the Execution screen — this board is the working view,
  // not the Cycle Overview summary (that's still what Test Cycles opens to).
  onOpenRun: (id: string) => void;
  onCreate: (input: CycleFormPayload) => Promise<void>;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Refetch the cycles list (used after a bulk import). */
  onReload?: () => void;
}

type BoardTab = 'all' | 'inprogress' | 'planned' | 'completed';
type MainTab = 'runs' | 'quicklogs';

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
  currentUserName,
  onOpenRun,
  onCreate,
  onUpdate,
  onDelete,
  onReload,
}: TestRunsBoardProps) {
  const [mainTab, setMainTab] = useState<MainTab>('runs');
  const [tab, setTab] = useState<BoardTab>('all');
  const [createRun, setCreateRun] = useState(false);
  // The rich "Log a test cycle" slide-over (Quick Logs tab) — null when
  // closed, 'new' when creating, or the cycle being edited.
  const [cyclePanel, setCyclePanel] = useState<'new' | TestCycle | null>(null);
  const [showImport, setShowImport] = useState(false);
  // Case-based run edit still uses the compact modal (its scope is fixed once
  // runs are generated -- see UpdateQuickLogModal's note).
  const [editingCycle, setEditingCycle] = useState<TestCycle | null>(null);
  // Clicking a quick log opens the SAME read-only info modal Analytics'
  // Cycle History / Issue Tracking reports use, instead of jumping straight
  // into the edit form -- the pencil icon remains the explicit way to edit.
  const [viewingCycleId, setViewingCycleId] = useState<string | null>(null);

  // Quick Logs table filters.
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [engineerFilter, setEngineerFilter] = useState('');
  const [portalFilter, setPortalFilter] = useState('');

  const siteUrl = useJiraSiteUrl(projectId);

  // Delete lives directly on each card/row -- not buried in the edit modal,
  // since deleting is a "look at the list, act on it" move, not an edit.
  const handleDelete = (c: TestCycle) => {
    const kind = (c.mode ?? 'CaseBased') === 'Manual' ? 'quick log' : 'test run';
    if (!window.confirm(`Delete this ${kind} — "${c.name}"?\n\nThis cannot be undone.`)) return;
    onDelete(c.id);
  };

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
  const knownVersions = Array.from(
    new Set(cycles.map(c => c.version).filter((v): v is string => !!v)),
  );

  // ── Quick Logs table: filter option lists + filtered rows ──────
  const distinct = (vals: (string | null | undefined)[]) =>
    Array.from(new Set(vals.filter((v): v is string => !!v && v.trim() !== ''))).sort();
  const moduleOptions = distinct(quickLogs.map(c => c.moduleName));
  const engineerOptions = distinct(quickLogs.map(c => c.loggedBy));
  const portalOptions = distinct(quickLogs.map(c => c.portalName));

  const filteredQuickLogs = useMemo(() => {
    const startMs = periodStart ? new Date(`${periodStart}T00:00:00`).getTime() : null;
    // End is inclusive of the whole day.
    const endMs = periodEnd ? new Date(`${periodEnd}T23:59:59`).getTime() : null;
    return quickLogs.filter(c => {
      const ts = new Date(c.completedAt ?? c.createdAt).getTime();
      if (startMs !== null && ts < startMs) return false;
      if (endMs !== null && ts > endMs) return false;
      if (moduleFilter && c.moduleName !== moduleFilter) return false;
      if (engineerFilter && c.loggedBy !== engineerFilter) return false;
      if (portalFilter && c.portalName !== portalFilter) return false;
      return true;
    });
  }, [quickLogs, periodStart, periodEnd, moduleFilter, engineerFilter, portalFilter]);

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
      <div className="flex-1 overflow-y-auto px-44 py-6">
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
            onClick={() => (mainTab === 'runs' ? setCreateRun(true) : setCyclePanel('new'))}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-[7px] text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover"
          >
            <i className="ti ti-plus text-[15px]" />
            {mainTab === 'runs' ? 'Add Test Run' : 'New cycle'}
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
                  <RunCard
                    key={c.id}
                    cycle={c}
                    onOpen={() => onOpenRun(c.id)}
                    onEdit={() => setEditingCycle(c)}
                    onDelete={() => handleDelete(c)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Toolbar: import / export / sample */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-text-3">
                Each row is one testing cycle. Click a row to view it, or the pencil to edit —
                retesting moves Done/Remaining on the same record.
              </p>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <ToolbarButton
                  icon="ti-upload"
                  label="Import"
                  onClick={() => projectId && setShowImport(true)}
                  disabled={!projectId}
                />
                <ToolbarButton
                  icon="ti-download"
                  label="Export"
                  onClick={() => exportCycles(filteredQuickLogs)}
                  disabled={filteredQuickLogs.length === 0}
                />
              </div>
            </div>

            {/* Filters */}
            {quickLogs.length > 0 && (
              <CycleFilters
                periodStart={periodStart}
                periodEnd={periodEnd}
                setPeriodStart={setPeriodStart}
                setPeriodEnd={setPeriodEnd}
                moduleFilter={moduleFilter}
                setModuleFilter={setModuleFilter}
                engineerFilter={engineerFilter}
                setEngineerFilter={setEngineerFilter}
                portalFilter={portalFilter}
                setPortalFilter={setPortalFilter}
                moduleOptions={moduleOptions}
                engineerOptions={engineerOptions}
                portalOptions={portalOptions}
              />
            )}

            {quickLogs.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-[12.5px] text-text-3">
                No testing cycles yet. Click “New cycle” to log one, or Import a sheet.
              </p>
            ) : filteredQuickLogs.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-[12.5px] text-text-3">
                No cycles match these filters.
              </p>
            ) : (
              <CyclesTable
                rows={filteredQuickLogs}
                siteUrl={siteUrl}
                onView={id => setViewingCycleId(id)}
                onEdit={c => setCyclePanel(c)}
                onDelete={handleDelete}
              />
            )}
          </>
        )}
      </div>

      {createRun && (
        <NewCycleModal
          modules={modules}
          projectId={projectId}
          defaultMode="CaseBased"
          onClose={() => setCreateRun(false)}
          onSave={async input => {
            await onCreate(input);
            setCreateRun(false);
          }}
        />
      )}

      {cyclePanel && (
        <CycleFormPanel
          projectId={projectId}
          knownVersions={knownVersions}
          initial={cyclePanel === 'new' ? null : cyclePanel}
          defaultEngineer={currentUserName}
          onClose={() => setCyclePanel(null)}
          onCreate={async input => {
            await onCreate(input);
            setCyclePanel(null);
          }}
          onUpdate={async (id, patch) => {
            await onUpdate(id, patch);
            setCyclePanel(null);
          }}
        />
      )}

      {showImport && projectId && (
        <ImportCyclesModal
          projectId={projectId}
          onClose={() => setShowImport(false)}
          onImported={() => onReload?.()}
        />
      )}

      {editingCycle && (
        <UpdateQuickLogModal
          log={editingCycle}
          projectId={projectId}
          onClose={() => setEditingCycle(null)}
          onSave={async patch => {
            await onUpdate(editingCycle.id, patch);
            setEditingCycle(null);
          }}
        />
      )}

      {viewingCycleId && (
        <CycleInfoModal
          cycleId={viewingCycleId}
          projectId={projectId}
          onClose={() => setViewingCycleId(null)}
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

function RunCard({
  cycle,
  onOpen,
  onEdit,
  onDelete,
}: {
  cycle: TestCycle;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const summary = cycle.summary;
  const total = summary?.total ?? 0;
  const done = summary?.done ?? 0;
  const percent = summary?.percent ?? 0;
  const passed = summary?.counts.Passed ?? 0;
  const failed = summary?.counts.Failed ?? 0;
  const blocked = summary?.counts.Blocked ?? 0;
  const isActive = cycle.status === 'Active';
  // Real id-based code -- a name-derived one comes up blank for most cycle
  // names (they rarely end in a trailing number), leaving cards with no code
  // at all. Matches the QL-XXXX pattern quick logs already use.
  const code = `C-${cycle.id.slice(-4).toUpperCase()}`;
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
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <span
            className={cn(
              'inline-flex flex-shrink-0 items-center gap-1.5 text-[11px] font-medium',
              status.text,
            )}
          >
            <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', status.dot)} />
            {status.label}
          </span>
          <button
            type="button"
            onClick={onEdit}
            title="Edit test run"
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-3 hover:bg-surface-2 hover:text-text"
          >
            <i className="ti ti-pencil text-[12px]" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete test run"
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-3 hover:bg-danger-bg hover:text-danger"
          >
            <i className="ti ti-trash text-[12px]" />
          </button>
        </div>
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

// ─── Quick Logs: toolbar / filters / table ──────────────────

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <i className={cn('ti text-[14px]', icon)} />
      {label}
    </button>
  );
}

function CycleFilters({
  periodStart,
  periodEnd,
  setPeriodStart,
  setPeriodEnd,
  moduleFilter,
  setModuleFilter,
  engineerFilter,
  setEngineerFilter,
  portalFilter,
  setPortalFilter,
  moduleOptions,
  engineerOptions,
  portalOptions,
}: {
  periodStart: string;
  periodEnd: string;
  setPeriodStart: (v: string) => void;
  setPeriodEnd: (v: string) => void;
  moduleFilter: string;
  setModuleFilter: (v: string) => void;
  engineerFilter: string;
  setEngineerFilter: (v: string) => void;
  portalFilter: string;
  setPortalFilter: (v: string) => void;
  moduleOptions: string[];
  engineerOptions: string[];
  portalOptions: string[];
}) {
  const selectCls =
    'rounded-[7px] border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-primary';
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
            Period
          </span>
          <input
            type="date"
            value={periodStart}
            onChange={e => setPeriodStart(e.target.value)}
            className={selectCls}
          />
          <span className="text-[12px] text-text-3">→</span>
          <input
            type="date"
            value={periodEnd}
            onChange={e => setPeriodEnd(e.target.value)}
            className={selectCls}
          />
          {(periodStart || periodEnd) && (
            <button
              type="button"
              onClick={() => {
                setPeriodStart('');
                setPeriodEnd('');
              }}
              className="text-[11.5px] text-text-3 underline-offset-2 hover:text-text hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
            Module
          </span>
          <select
            value={moduleFilter}
            onChange={e => setModuleFilter(e.target.value)}
            className={selectCls}
          >
            <option value="">All modules</option>
            {moduleOptions.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
            Engineer
          </span>
          <select
            value={engineerFilter}
            onChange={e => setEngineerFilter(e.target.value)}
            className={selectCls}
          >
            <option value="">All engineers</option>
            {engineerOptions.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {portalOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
            Portal
          </span>
          <FilterChip
            active={portalFilter === ''}
            onClick={() => setPortalFilter('')}
            label="All"
          />
          {portalOptions.map(p => (
            <FilterChip
              key={p}
              active={portalFilter === p}
              onClick={() => setPortalFilter(portalFilter === p ? '' : p)}
              label={p}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors',
        active
          ? 'bg-primary text-white'
          : 'border border-border bg-surface text-text-2 hover:bg-surface-2',
      )}
    >
      {label}
    </button>
  );
}

function outcomeTone(outcome: CycleOutcome): { bg: string; text: string } {
  if (outcome === 'Pass') return { bg: 'bg-success-bg', text: 'text-success-text' };
  if (outcome === 'Fail') return { bg: 'bg-danger-bg', text: 'text-danger-text' };
  return { bg: 'bg-warning-bg', text: 'text-warning-text' }; // Open
}

function CyclesTable({
  rows,
  siteUrl,
  onView,
  onEdit,
  onDelete,
}: {
  rows: TestCycle[];
  siteUrl: string | null;
  onView: (id: string) => void;
  onEdit: (c: TestCycle) => void;
  onDelete: (c: TestCycle) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-border bg-surface-2 text-[10.5px] uppercase tracking-wide text-text-3">
            <th className="px-3 py-2.5 text-left font-semibold">Date</th>
            <th className="px-3 py-2.5 text-left font-semibold">Module · Feature</th>
            <th className="px-3 py-2.5 text-left font-semibold">Env</th>
            <th className="px-3 py-2.5 text-left font-semibold">Type</th>
            <th className="px-3 py-2.5 text-left font-semibold">Ticket</th>
            <th className="px-3 py-2.5 text-left font-semibold">Issues</th>
            <th className="px-3 py-2.5 text-right font-semibold">Open</th>
            <th className="px-3 py-2.5 text-left font-semibold">Outcome</th>
            <th className="px-3 py-2.5 text-right font-semibold" />
          </tr>
        </thead>
        <tbody>
          {rows.map(c => (
            <CycleRow
              key={c.id}
              c={c}
              siteUrl={siteUrl}
              onView={() => onView(c.id)}
              onEdit={() => onEdit(c)}
              onDelete={() => onDelete(c)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CycleRow({
  c,
  siteUrl,
  onView,
  onEdit,
  onDelete,
}: {
  c: TestCycle;
  siteUrl: string | null;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const total = c.issueCount ?? 0;
  const open = c.remainingCount ?? Math.max(0, total - (c.doneCount ?? 0));
  const outcome = deriveOutcome(c);
  const tone = outcomeTone(outcome);
  const moduleName = c.moduleName || c.portalName || 'Unscoped';
  const unmapped = !c.scopeId && (c.moduleName || c.featureName);
  const sev: { v: number; dot: string }[] = [
    { v: c.criticalCount ?? 0, dot: 'bg-danger' },
    { v: c.majorCount ?? 0, dot: 'bg-warning' },
    { v: c.minorCount ?? 0, dot: 'bg-text-3' },
  ];

  return (
    <tr
      onClick={onView}
      className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-2"
    >
      <td className="whitespace-nowrap px-3 py-2.5 text-text-2">
        {localDateStr(new Date(c.completedAt ?? c.createdAt))}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text">{c.name || moduleName}</span>
          {unmapped && (
            <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[9.5px] text-text-3">
              Unmapped
            </span>
          )}
        </div>
        {(c.moduleName || c.featureName) && (
          <p className="text-[11px] text-text-3">
            {[c.moduleName, c.featureName].filter(Boolean).join(' · ')}
          </p>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{c.environment || '—'}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{c.cycleCategory || '—'}</td>
      <td className="whitespace-nowrap px-3 py-2.5" onClick={e => e.stopPropagation()}>
        {c.ticketLink ? (
          <JiraTicketLink
            ticketLink={c.ticketLink}
            siteUrl={c.jiraSiteUrl ?? siteUrl}
            className="font-mono text-[11.5px]"
          />
        ) : (
          <span className="text-text-3">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-text">{total}</span>
          {total > 0 &&
            sev.map((s, i) => (
              <span
                key={i}
                className="inline-flex min-w-[18px] items-center justify-center gap-1 rounded bg-surface-2 px-1 py-0.5 text-[10px] text-text-2"
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                {s.v}
              </span>
            ))}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <span className={cn('font-semibold', open > 0 ? 'text-text' : 'text-text-3')}>{open}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
            tone.bg,
            tone.text,
          )}
        >
          {outcome}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onEdit}
            title="Edit cycle"
            className="flex h-6 w-6 items-center justify-center rounded text-text-3 hover:bg-surface-3 hover:text-text"
          >
            <i className="ti ti-pencil text-[13px]" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete cycle"
            className="flex h-6 w-6 items-center justify-center rounded text-text-3 hover:bg-danger-bg hover:text-danger"
          >
            <i className="ti ti-trash text-[13px]" />
          </button>
        </div>
      </td>
    </tr>
  );
}
