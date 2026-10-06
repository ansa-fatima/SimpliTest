'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { parseIssueKeys } from '@/lib/jira';
import { api } from '@/lib/client';

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
  const [periodMode, setPeriodMode] = useState<'all' | 'custom'>('all');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [sprintFilter, setSprintFilter] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [engineerFilter, setEngineerFilter] = useState('');
  const [portalFilter, setPortalFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<'' | CycleOutcome>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination for the Quick Logs table. Default 10, same options the
  // mockup shows. Page resets to 0 whenever a filter / search / page-size
  // changes, so the user never ends up on an empty page.
  const PAGE_SIZES = [10, 25, 50, 100] as const;
  const [pageSize, setPageSize] = useState<number>(10);
  const [pageIndex, setPageIndex] = useState(0);

  // Pull the sprint number out of version strings like "v3.0.140" or
  // "Version: 4.0.140" -- the third dotted segment is the sprint. Anything
  // not matching that pattern (empty / mobile versions like v3.6.4) stays
  // out of the dropdown, which is deliberate: those aren't sprint-anchored.
  const sprintOf = (v: string | null | undefined): string | null => {
    if (!v) return null;
    const m = v.match(/\b\d+\.\d+\.(\d+)\b/);
    return m ? `Sprint ${m[1]}` : null;
  };

  const siteUrl = useJiraSiteUrl(projectId);
  const [syncAllState, setSyncAllState] = useState<{
    running: boolean;
    done: number;
    total: number;
    failed: number;
  }>({ running: false, done: 0, total: 0, failed: 0 });

  // Resync EVERY filtered quick log against its parent Jira ticket. Runs
  // one call at a time deliberately -- Atlassian rate-limits the Cloud
  // REST API hard enough that a parallel burst gets 429'd and leaves half
  // the cycles unsynced, which is worse than a slower, complete run.
  const syncAll = async () => {
    if (!projectId) return;
    const targets = filteredQuickLogs.filter(c => c.ticketLink);
    if (targets.length === 0) {
      alert('Nothing to sync — no filtered rows have a parent ticket.');
      return;
    }
    if (
      !window.confirm(
        `Sync ${targets.length} quick log${targets.length === 1 ? '' : 's'} from Jira?`,
      )
    )
      return;
    setSyncAllState({ running: true, done: 0, total: targets.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const c of targets) {
      try {
        const result = await api.post<{
          title: string;
          status: string;
          issueCount: number;
          criticalCount: number;
          majorCount: number;
          minorCount: number;
          doneCount: number;
          remainingCount: number;
          reopenedCount: number;
          siteUrl: string;
          subIssues: unknown[];
        }>(`/api/projects/${projectId}/integrations/jira/fetch`, { ticketLink: c.ticketLink });
        await api.patch(`/api/cycles/${c.id}`, {
          ...(result.title ? { name: result.title } : {}),
          jiraStatus: result.status,
          jiraSyncedAt: new Date().toISOString(),
          jiraSiteUrl: result.siteUrl,
          issueCount: result.issueCount,
          criticalCount: result.criticalCount,
          majorCount: result.majorCount,
          minorCount: result.minorCount,
          doneCount: result.doneCount,
          remainingCount: result.remainingCount,
          reopenedCount: result.reopenedCount,
          jiraSubIssues: result.subIssues,
        });
        done++;
      } catch {
        failed++;
      }
      setSyncAllState({ running: true, done: done + failed, total: targets.length, failed });
    }
    setSyncAllState({ running: false, done, total: targets.length, failed });
    // The cycles list is served from the parent; a quick page refresh is
    // the cheapest way to see every PATCH land in the row.
    window.location.reload();
  };

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
  // Newest sprint first, so recent work is one click away.
  const sprintOptions = Array.from(
    new Set(quickLogs.map(c => sprintOf(c.version)).filter((v): v is string => !!v)),
  ).sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10);
    const nb = parseInt(b.replace(/\D/g, ''), 10);
    return nb - na;
  });

  const filteredQuickLogs = useMemo(() => {
    const useCustom = periodMode === 'custom';
    const startMs = useCustom && periodStart ? new Date(`${periodStart}T00:00:00`).getTime() : null;
    // End is inclusive of the whole day.
    const endMs = useCustom && periodEnd ? new Date(`${periodEnd}T23:59:59`).getTime() : null;
    const q = searchQuery.trim().toLowerCase();
    return quickLogs.filter(c => {
      const ts = new Date(c.completedAt ?? c.createdAt).getTime();
      if (startMs !== null && ts < startMs) return false;
      if (endMs !== null && ts > endMs) return false;
      if (sprintFilter && sprintOf(c.version) !== sprintFilter) return false;
      if (moduleFilter && c.moduleName !== moduleFilter) return false;
      if (engineerFilter && c.loggedBy !== engineerFilter) return false;
      if (portalFilter && c.portalName !== portalFilter) return false;
      if (outcomeFilter && deriveOutcome(c) !== outcomeFilter) return false;
      if (q) {
        // Search sweeps the fields a reader scans visually -- title,
        // module/feature, ticket key, tester name -- so typing part of any
        // one of them narrows the list the way they'd expect.
        const hay = [c.name, c.moduleName, c.featureName, c.ticketLink, c.loggedBy]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    quickLogs,
    periodMode,
    periodStart,
    periodEnd,
    sprintFilter,
    moduleFilter,
    engineerFilter,
    portalFilter,
    outcomeFilter,
    searchQuery,
  ]);

  // Reset to page 0 whenever the filtered set shrinks or the page size
  // changes, so an edit that drops below the current window doesn't leave
  // the viewer stranded on an empty page.
  useEffect(() => {
    setPageIndex(0);
  }, [
    filteredQuickLogs.length,
    pageSize,
    searchQuery,
    outcomeFilter,
    moduleFilter,
    engineerFilter,
    portalFilter,
    sprintFilter,
    periodMode,
    periodStart,
    periodEnd,
  ]);

  const totalRows = filteredQuickLogs.length;
  const pageStart = pageIndex * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, totalRows);
  const pagedQuickLogs = useMemo(
    () => filteredQuickLogs.slice(pageStart, pageEnd),
    [filteredQuickLogs, pageStart, pageEnd],
  );
  const canPrev = pageIndex > 0;
  const canNext = pageEnd < totalRows;

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
                  icon={syncAllState.running ? 'ti-loader-2' : 'ti-refresh'}
                  label={
                    syncAllState.running
                      ? `Syncing ${syncAllState.done} / ${syncAllState.total}${
                          syncAllState.failed > 0 ? ` · ${syncAllState.failed} failed` : ''
                        }`
                      : 'Sync all'
                  }
                  onClick={syncAll}
                  disabled={
                    !projectId ||
                    syncAllState.running ||
                    filteredQuickLogs.filter(c => c.ticketLink).length === 0
                  }
                />
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
                periodMode={periodMode}
                setPeriodMode={setPeriodMode}
                periodStart={periodStart}
                periodEnd={periodEnd}
                setPeriodStart={setPeriodStart}
                setPeriodEnd={setPeriodEnd}
                sprintFilter={sprintFilter}
                setSprintFilter={setSprintFilter}
                moduleFilter={moduleFilter}
                setModuleFilter={setModuleFilter}
                engineerFilter={engineerFilter}
                setEngineerFilter={setEngineerFilter}
                portalFilter={portalFilter}
                setPortalFilter={setPortalFilter}
                outcomeFilter={outcomeFilter}
                setOutcomeFilter={setOutcomeFilter}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                moduleOptions={moduleOptions}
                engineerOptions={engineerOptions}
                portalOptions={portalOptions}
                sprintOptions={sprintOptions}
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
              <>
                <CyclesTable
                  rows={pagedQuickLogs}
                  siteUrl={siteUrl}
                  onView={id => setViewingCycleId(id)}
                  onEdit={c => setCyclePanel(c)}
                  onDelete={handleDelete}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-text-2">
                  <div className="flex items-center gap-2">
                    <span className="text-text-3">Rows per page:</span>
                    <select
                      value={pageSize}
                      onChange={e => setPageSize(Number(e.target.value))}
                      className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-text outline-none focus:border-primary"
                    >
                      {PAGE_SIZES.map(n => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-text-3">
                      {totalRows === 0 ? '0' : `${pageStart + 1} – ${pageEnd}`} of {totalRows}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!canPrev}
                        onClick={() => setPageIndex(p => Math.max(0, p - 1))}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-2 transition-colors enabled:hover:bg-surface-2 enabled:hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                        title="Previous page"
                      >
                        <i className="ti ti-chevron-left text-[14px]" />
                      </button>
                      <button
                        type="button"
                        disabled={!canNext}
                        onClick={() => setPageIndex(p => p + 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-2 transition-colors enabled:hover:bg-surface-2 enabled:hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                        title="Next page"
                      >
                        <i className="ti ti-chevron-right text-[14px]" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
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
          knownQuickLogs={quickLogs.map(c => ({
            moduleName: c.moduleName ?? null,
            featureName: c.featureName ?? null,
          }))}
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
  periodMode,
  setPeriodMode,
  periodStart,
  periodEnd,
  setPeriodStart,
  setPeriodEnd,
  sprintFilter,
  setSprintFilter,
  moduleFilter,
  setModuleFilter,
  engineerFilter,
  setEngineerFilter,
  portalFilter,
  setPortalFilter,
  outcomeFilter,
  setOutcomeFilter,
  searchQuery,
  setSearchQuery,
  moduleOptions,
  engineerOptions,
  portalOptions,
  sprintOptions,
}: {
  periodMode: 'all' | 'custom';
  setPeriodMode: (v: 'all' | 'custom') => void;
  periodStart: string;
  periodEnd: string;
  setPeriodStart: (v: string) => void;
  setPeriodEnd: (v: string) => void;
  sprintFilter: string;
  setSprintFilter: (v: string) => void;
  moduleFilter: string;
  setModuleFilter: (v: string) => void;
  engineerFilter: string;
  setEngineerFilter: (v: string) => void;
  portalFilter: string;
  setPortalFilter: (v: string) => void;
  outcomeFilter: '' | CycleOutcome;
  setOutcomeFilter: (v: '' | CycleOutcome) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  moduleOptions: string[];
  engineerOptions: string[];
  portalOptions: string[];
  sprintOptions: string[];
}) {
  const selectCls =
    'rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text outline-none focus:border-primary';
  const labelCls = 'text-[10.5px] font-semibold uppercase tracking-wide text-text-3';
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      {/* Row 0 -- Search box + Outcome chips. Search covers title, module,
          feature, ticket and tester, so the keyboard-first way to find a
          cycle is the one typists expect. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative min-w-[220px] flex-1">
          <i className="ti ti-search pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-text-3" />
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search title, module, feature, ticket or tester…"
            className="w-full rounded-full border border-border bg-surface py-1.5 pl-8 pr-3 text-[12.5px] text-text outline-none focus:border-primary"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 hover:text-text"
              title="Clear search"
            >
              <i className="ti ti-x text-[12px]" />
            </button>
          )}
        </div>
        <span className={labelCls}>Outcome</span>
        <FilterChip
          active={outcomeFilter === ''}
          onClick={() => setOutcomeFilter('')}
          label="All"
        />
        {(['Pass', 'Fail', 'Blocked', 'Open'] as const).map(o => (
          <FilterChip
            key={o}
            active={outcomeFilter === o}
            onClick={() => setOutcomeFilter(outcomeFilter === o ? '' : o)}
            label={o}
          />
        ))}
      </div>

      {/* Row 1 -- Period pills + Sprints dropdown */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={labelCls}>Period</span>
        <FilterChip
          active={periodMode === 'all'}
          onClick={() => {
            setPeriodMode('all');
            setPeriodStart('');
            setPeriodEnd('');
          }}
          label="All time"
        />
        <FilterChip
          active={periodMode === 'custom'}
          onClick={() => setPeriodMode('custom')}
          label="Custom range"
        />
        <select
          value={sprintFilter}
          onChange={e => setSprintFilter(e.target.value)}
          className={selectCls}
        >
          <option value="">Sprints</option>
          {sprintOptions.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {periodMode === 'custom' && (
          <div className="flex items-center gap-2">
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
        )}
      </div>

      {/* Row 2 -- Module / Engineer dropdowns + Portal pills */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={labelCls}>Module</span>
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

        <span className={cn(labelCls, 'ml-3')}>Engineer</span>
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

        {portalOptions.length > 0 && (
          <>
            <span className={cn(labelCls, 'ml-3')}>Portal</span>
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
          </>
        )}
      </div>
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
  if (outcome === 'Blocked') return { bg: 'bg-slate-500/15', text: 'text-slate-600' };
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
            <th className="px-3 py-2.5 text-left font-semibold">Tested by</th>
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
  const tester = (c.loggedBy ?? '').trim();
  // Per-severity chips -- label is for the hover tooltip; `pill` is the
  // whole chip's tint (not just the dot) so the colour reads clearly even
  // against the row's hover state.
  const sev: { v: number; label: 'Critical' | 'Major' | 'Minor'; pill: string }[] = [
    { v: c.criticalCount ?? 0, label: 'Critical', pill: 'bg-danger/15 text-danger' },
    { v: c.majorCount ?? 0, label: 'Major', pill: 'bg-warning/15 text-warning' },
    { v: c.minorCount ?? 0, label: 'Minor', pill: 'bg-yellow-400/15 text-yellow-600' },
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
        </div>
        {(c.moduleName || c.featureName) && (
          <p className="text-[11px] text-text-3">
            {[c.moduleName, c.featureName].filter(Boolean).join(' · ')}
          </p>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {tester ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-text-2">
            <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9.5px] font-semibold uppercase text-primary">
              {tester
                .split(/\s+/)
                .map(w => w[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')}
            </span>
            {tester}
          </span>
        ) : (
          <span className="text-text-3">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{c.environment || '—'}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{c.cycleCategory || '—'}</td>
      <td className="whitespace-nowrap px-3 py-2.5" onClick={e => e.stopPropagation()}>
        {(() => {
          const keys = parseIssueKeys(c.ticketLink);
          if (keys.length === 0) {
            // Nothing parseable: fall back to showing the raw text (not clickable).
            return c.ticketLink ? (
              <span className="font-mono text-[11.5px] text-text-2">{c.ticketLink}</span>
            ) : (
              <span className="text-text-3">—</span>
            );
          }
          // One link per key, so clicking NPD-10577 opens 10577 -- not the
          // first key the field happened to start with.
          return (
            <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
              {keys.map((k, i) => (
                <span key={k} className="inline-flex items-center">
                  <JiraTicketLink
                    ticketLink={k}
                    siteUrl={c.jiraSiteUrl ?? siteUrl}
                    className="font-mono text-[11.5px]"
                  />
                  {i < keys.length - 1 && <span className="text-text-3">,</span>}
                </span>
              ))}
            </span>
          );
        })()}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-text">{total}</span>
          {total > 0 &&
            sev.map(s => (
              <span
                key={s.label}
                title={`${s.label}: ${s.v}`}
                className={cn(
                  'inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                  s.pill,
                )}
              >
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
