'use client';

import { useEffect, useMemo, useState } from 'react';
import { TestCycle, Module } from '@/types';
import { avatarColour, cn, initials, localDateStr } from '@/lib/utils';
import { deriveOutcome, CycleOutcome } from '@/lib/cycleOutcome';
import { exportCycles } from '@/lib/export';
import { CycleFormPayload } from './NewCycleModal';
import { UpdateQuickLogModal } from './QuickLogModal';
import { CycleFormPanel } from './CycleFormPanel';
import { ImportCyclesModal } from './ImportCyclesModal';
import { CycleInfoModal } from './CycleInfoModal';
import { JiraTicketLink, useJiraSiteUrl } from '@/lib/jiraLink';
import { parseIssueKeys } from '@/lib/jira';
import { api } from '@/lib/client';
import { SIco } from '@/components/layout/sts-icons';
import { avatarGradient } from './tc-helpers';
import './sts-v3.css';

interface TestRunsBoardProps {
  cycles: TestCycle[];
  loading: boolean;
  modules: Module[];
  projectId: string | null;
  projectName?: string;
  /** `runs` = case-based test runs; `quicklogs` = aggregate quick logs. Separate flows. */
  mode: 'runs' | 'quicklogs';
  /** Session user, used to default the QA Engineer field on a new cycle. */
  currentUserName?: string;
  // Goes straight to the Execution screen — this board is the working view,
  // not the Cycle Overview summary (that's still what Test Cycles opens to).
  onOpenRun: (id: string) => void;
  /** Run detail / summary page. */
  onOpenOverview: (id: string) => void;
  /** Opens the full-page New test run form. */
  onNewRun: () => void;
  onCreate: (input: CycleFormPayload) => Promise<unknown>;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Refetch the cycles list (used after a bulk import). */
  onReload?: () => void;
}

// Profile pictures: a log/run only stores the tester's NAME, so look the person
// up by name / username / email (one shared fetch, refreshed every 10 seconds).
type AvatarMap = Map<string, string>;
let avatarCache: { at: number; p: Promise<AvatarMap> } | null = null;
function loadAvatars(): Promise<AvatarMap> {
  if (!avatarCache || Date.now() - avatarCache.at > 10_000) {
    avatarCache = {
      at: Date.now(),
      p: api
        .get<{ name: string | null; username: string; email: string; avatarUrl: string | null }[]>(
          '/api/users',
        )
        .then(users => {
          const m: AvatarMap = new Map();
          for (const u of users) {
            if (!u.avatarUrl) continue;
            for (const k of [u.name, u.username, u.email])
              if (k && k.trim()) m.set(k.trim().toLowerCase(), u.avatarUrl);
          }
          return m;
        })
        .catch(() => new Map<string, string>()),
    };
  }
  return avatarCache.p;
}
function useUserAvatars(): AvatarMap {
  const [m, setM] = useState<AvatarMap>(new Map());
  useEffect(() => {
    let live = true;
    loadAvatars().then(x => live && setM(x));
    return () => {
      live = false;
    };
  }, []);
  return m;
}

// Initials-in-a-gradient circle, or the person's profile picture when they have one.
function PersonAvatar({ name, avatars }: { name: string; avatars: AvatarMap }) {
  const url = avatars.get(name.trim().toLowerCase());
  if (url) {
    return (
      <span className="avatar sm" style={{ background: 'transparent', overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
        />
      </span>
    );
  }
  return (
    <span className="avatar sm" style={{ background: avatarGradient(name) }}>
      {initials(name)}
    </span>
  );
}

// "Planned" isn't a real DB status -- it's an Active cycle nobody has
// started executing yet (0 runs touched). Once at least one run has a
// verdict, it reads as "In Progress" instead.
function isStarted(c: TestCycle): boolean {
  return (c.summary?.done ?? 0) > 0;
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
  projectName,
  mode,
  currentUserName,
  onOpenRun,
  onOpenOverview,
  onNewRun,
  onCreate,
  onUpdate,
  onDelete,
  onReload,
}: TestRunsBoardProps) {
  const [runsFilter, setRunsFilter] = useState<'all' | 'planned' | 'active' | 'closed' | 'mine'>(
    'all',
  );
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

  // Counts shown next to each Outcome chip. Each chip counts rows that
  // match EVERY OTHER filter -- changing which outcome is highlighted
  // doesn't change these counts, which is the behaviour the mockup needs
  // (so the user sees "there are 12 Pass rows available right now",
  // whether or not the Pass chip is currently selected).
  const outcomeCounts = useMemo(() => {
    const useCustom = periodMode === 'custom';
    const startMs = useCustom && periodStart ? new Date(`${periodStart}T00:00:00`).getTime() : null;
    const endMs = useCustom && periodEnd ? new Date(`${periodEnd}T23:59:59`).getTime() : null;
    const q = searchQuery.trim().toLowerCase();
    const base = quickLogs.filter(c => {
      const ts = new Date(c.completedAt ?? c.createdAt).getTime();
      if (startMs !== null && ts < startMs) return false;
      if (endMs !== null && ts > endMs) return false;
      if (sprintFilter && sprintOf(c.version) !== sprintFilter) return false;
      if (moduleFilter && c.moduleName !== moduleFilter) return false;
      if (engineerFilter && c.loggedBy !== engineerFilter) return false;
      if (portalFilter && c.portalName !== portalFilter) return false;
      if (q) {
        const hay = [c.name, c.moduleName, c.featureName, c.ticketLink, c.loggedBy]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const counts: Record<CycleOutcome, number> = { Pass: 0, Fail: 0, Blocked: 0, Open: 0 };
    for (const c of base) {
      const o = deriveOutcome(c);
      counts[o] = (counts[o] ?? 0) + 1;
    }
    return { all: base.length, ...counts };
  }, [
    quickLogs,
    periodMode,
    periodStart,
    periodEnd,
    sprintFilter,
    moduleFilter,
    engineerFilter,
    portalFilter,
    searchQuery,
  ]);

  const inProgress = caseBased.filter(c => c.status === 'Active' && isStarted(c));
  const planned = caseBased.filter(c => c.status === 'Active' && !isStarted(c));
  const completed = caseBased.filter(c => c.status === 'Completed');

  const isRuns = mode === 'runs';
  const activeRuns = caseBased.filter(c => c.status === 'Active');
  const pendingCases = activeRuns.reduce(
    (n, c) => n + Math.max(0, (c.summary?.total ?? 0) - (c.summary?.done ?? 0)),
    0,
  );
  const totalIssues = quickLogs.reduce((n, c) => n + (c.issueCount ?? 0), 0);
  const mine = caseBased.filter(
    c => !!currentUserName && !!c.tester && c.tester === currentUserName,
  );
  const visibleRuns =
    runsFilter === 'planned'
      ? planned
      : runsFilter === 'active'
        ? inProgress
        : runsFilter === 'closed'
          ? completed
          : runsFilter === 'mine'
            ? mine
            : caseBased;

  return (
    <div className="stv3 main-scroll">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <span className="crumb">{projectName || 'Project'}</span>
            <span className="sep">/</span>
            <span className="current">{isRuns ? 'Test runs & results' : 'Quick logs'}</span>
          </div>
          <h1 className="page-title">
            {isRuns ? (
              <>
                Test runs &amp; <em>results</em>
              </>
            ) : (
              <>
                Quick <em>logs</em>
              </>
            )}
          </h1>
          <div className="page-sub">
            {isRuns
              ? `${activeRuns.length} active ${activeRuns.length === 1 ? 'run' : 'runs'} · ${pendingCases.toLocaleString()} cases pending execution`
              : `${quickLogs.length} ${quickLogs.length === 1 ? 'log' : 'logs'} · ${totalIssues.toLocaleString()} issues logged — a 30-second aggregate result, no per-case execution`}
          </div>
        </div>
        <div className="page-actions">
          {isRuns ? (
            <button type="button" className="btn btn-primary" onClick={onNewRun}>
              <SIco name="play" />
              New test run
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={syncAll}
                disabled={
                  !projectId ||
                  syncAllState.running ||
                  filteredQuickLogs.filter(c => c.ticketLink).length === 0
                }
              >
                <SIco name="retry" />
                {syncAllState.running
                  ? `Syncing ${syncAllState.done} / ${syncAllState.total}${
                      syncAllState.failed > 0 ? ` · ${syncAllState.failed} failed` : ''
                    }`
                  : 'Sync all'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => projectId && setShowImport(true)}
                disabled={!projectId}
              >
                <SIco name="upload" />
                Import
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => exportCycles(filteredQuickLogs)}
                disabled={filteredQuickLogs.length === 0}
              >
                <SIco name="download" />
                Export
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setCyclePanel('new')}
              >
                <SIco name="plus" />
                New quick log
              </button>
            </>
          )}
        </div>
      </div>

      {isRuns ? (
        <>
          <div className="filter-pills" style={{ marginBottom: 18 }}>
            {(
              [
                ['all', 'All', caseBased.length],
                ['planned', 'Planned', planned.length],
                ['active', 'Active', inProgress.length],
                ['closed', 'Closed', completed.length],
                ['mine', 'My runs', mine.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={cn('fpill', runsFilter === key && 'active')}
                onClick={() => setRunsFilter(key)}
              >
                {label} <span className="count">{count}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="card">
              <div className="empty-note">Loading…</div>
            </div>
          ) : visibleRuns.length === 0 ? (
            <div className="card">
              <div className="empty-note">
                {caseBased.length === 0 ? (
                  <>
                    No test runs yet.{' '}
                    <button type="button" className="btn-link" onClick={onNewRun}>
                      Create the first one
                    </button>
                  </>
                ) : (
                  'No runs in this view.'
                )}
              </div>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-head" style={{ background: 'var(--c-bg)' }}>
                <h3>
                  <SIco name="play" /> Test runs
                </h3>
                <span className="meta">
                  {visibleRuns.length} {visibleRuns.length === 1 ? 'run' : 'runs'}
                </span>
              </div>
              <RunsTable
                rows={visibleRuns}
                onExecute={onOpenRun}
                onDetails={onOpenOverview}
                onEdit={setEditingCycle}
                onDelete={handleDelete}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--t-3)', margin: '0 0 12px' }}>
            Each row is one testing cycle. Click a row to view it, or the pencil to edit — retesting
            moves Done/Remaining on the same record.
          </p>
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
              outcomeCounts={outcomeCounts}
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
              No quick logs yet. Click “New quick log” to add one, or Import a sheet.
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
                    className="sts-select rounded-md border border-border bg-[var(--c-surface)] py-1 !pr-7 pl-2 text-[12px] text-[var(--t-1)] outline-none focus:border-[var(--brand-700)]"
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

// ─── Test runs table (screen 06) ────────────────────────────

function runStatus(c: TestCycle): { label: string; pill: string; dot: boolean } {
  if (c.status === 'Completed') return { label: 'Closed', pill: 'pill-ok', dot: true };
  if (c.status === 'Archived') return { label: 'Archived', pill: 'pill-neutral', dot: false };
  if (!isStarted(c)) return { label: 'Planned', pill: 'pill-neutral', dot: true };
  const counts = c.summary?.counts;
  const done = c.summary?.done ?? 0;
  if (counts && done > 0 && counts.Failed / done >= 0.25)
    return { label: 'Failing', pill: 'pill-err', dot: true };
  if (counts && counts.Blocked > 0 && counts.Blocked >= counts.Failed)
    return { label: 'Blocked', pill: 'pill-warn', dot: true };
  return { label: 'Running', pill: 'pill-info', dot: true };
}

function RunsTable({
  rows,
  onExecute,
  onDetails,
  onEdit,
  onDelete,
}: {
  rows: TestCycle[];
  onExecute: (id: string) => void;
  onDetails: (id: string) => void;
  onEdit: (c: TestCycle) => void;
  onDelete: (c: TestCycle) => void;
}) {
  return (
    <table className="t runs-table">
      <thead>
        <tr>
          <th>Run</th>
          <th>Status</th>
          <th>Milestone</th>
          <th>Progress</th>
          <th>Pass</th>
          <th>Owner</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map(c => (
          <RunRow
            key={c.id}
            cycle={c}
            onExecute={() => onExecute(c.id)}
            onDetails={() => onDetails(c.id)}
            onEdit={() => onEdit(c)}
            onDelete={() => onDelete(c)}
          />
        ))}
      </tbody>
    </table>
  );
}

function RunRow({
  cycle: c,
  onExecute,
  onDetails,
  onEdit,
  onDelete,
}: {
  cycle: TestCycle;
  onExecute: () => void;
  onDetails: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const avatars = useUserAvatars();
  // The menu is position:fixed (anchored to the button) because the table card
  // clips overflow -- an absolutely positioned dropdown got cut off inside it.
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const s = c.summary;
  const total = s?.total ?? 0;
  const done = s?.done ?? 0;
  const counts = s?.counts ?? { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const passRate = done === 0 ? null : (counts.Passed / done) * 100;
  const st = runStatus(c);
  const active = c.status === 'Active';
  const scope = c.scopeName ?? (c.scopeType === 'All' ? 'All cases' : c.scopeType);
  const version = c.version ? `v${c.version.replace(/^v\s*/i, '')}` : null;

  return (
    <tr>
      <td className="rt-title">
        <div className="row-title" style={{ cursor: 'pointer' }} onClick={onDetails}>
          {c.name}
        </div>
        <div className="id-mono">
          {scope} · {total.toLocaleString()} cases
        </div>
      </td>
      <td className="rt-status">
        <span className={cn('pill', st.pill)}>
          {st.dot && <span className="dot" />} {st.label}
        </span>
      </td>
      <td className={cn('rt-milestone', !version && 'rt-empty')}>
        {version ? (
          <span className={cn('pill', active ? 'pill-brand' : 'pill-neutral')}>{version}</span>
        ) : (
          <span style={{ color: 'var(--t-4)' }}>—</span>
        )}
      </td>
      <td className="rt-progress">
        <div className="progress" style={{ width: 140 }}>
          <div className="progress-stacked">
            <span style={{ width: `${pct(counts.Passed)}%`, background: 'var(--ok)' }} />
            <span style={{ width: `${pct(counts.Failed)}%`, background: 'var(--err)' }} />
            <span style={{ width: `${pct(counts.Blocked)}%`, background: 'var(--warn)' }} />
            <span style={{ width: `${pct(counts.Skipped)}%`, background: 'var(--info)' }} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 3 }}>
          {done.toLocaleString()} / {total.toLocaleString()}
          {st.label === 'Failing' ? ` · ${counts.Failed} failed` : ''}
        </div>
      </td>
      <td className="rt-pass" data-label="Pass">
        <span
          style={{
            fontWeight: 600,
            color:
              passRate === null
                ? 'var(--t-4)'
                : passRate >= 85
                  ? 'var(--ok)'
                  : passRate >= 60
                    ? 'var(--warn)'
                    : 'var(--err)',
          }}
        >
          {passRate === null ? '—' : `${passRate.toFixed(1)}%`}
        </span>
      </td>
      <td className="rt-owner" data-label="Owner">
        {c.tester ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PersonAvatar name={c.tester} avatars={avatars} />
            {c.tester.split(/\s+/)[0]}
          </div>
        ) : (
          <span style={{ color: 'var(--t-4)' }}>Unassigned</span>
        )}
      </td>
      <td className="rt-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
          {active && (
            <button
              type="button"
              className={cn('btn btn-sm', isStarted(c) ? 'btn-secondary' : 'btn-primary')}
              onClick={onExecute}
            >
              {isStarted(c) ? (
                'Resume'
              ) : (
                <>
                  <SIco name="play" /> Execute
                </>
              )}
            </button>
          )}
          <button
            type="button"
            className="icon-btn row-menu-btn"
            aria-label="Run actions"
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu(m => (m ? null : { top: r.bottom + 6, right: window.innerWidth - r.right }));
            }}
          >
            <SIco name="dots" />
          </button>
          {menu && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 30 }}
                onClick={() => setMenu(null)}
              />
              <div
                className="tb-menu"
                style={{
                  width: 170,
                  zIndex: 31,
                  position: 'fixed',
                  top: menu.top,
                  right: menu.right,
                }}
              >
                <button
                  type="button"
                  className="tb-menu-item"
                  onClick={() => {
                    setMenu(null);
                    onDetails();
                  }}
                >
                  <SIco name="info" size={14} />
                  <span className="grow">View details</span>
                </button>
                {!active && (
                  <button
                    type="button"
                    className="tb-menu-item"
                    onClick={() => {
                      setMenu(null);
                      onExecute();
                    }}
                  >
                    <SIco name="play" size={14} />
                    <span className="grow">View results</span>
                  </button>
                )}
                <button
                  type="button"
                  className="tb-menu-item"
                  onClick={() => {
                    setMenu(null);
                    onEdit();
                  }}
                >
                  <SIco name="edit" size={14} />
                  <span className="grow">Edit</span>
                </button>
                <hr />
                <button
                  type="button"
                  className="tb-menu-item danger"
                  onClick={() => {
                    setMenu(null);
                    onDelete();
                  }}
                >
                  <SIco name="trash" size={14} />
                  <span className="grow">Delete</span>
                </button>
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Quick Logs: toolbar / filters / table ──────────────────

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
  outcomeCounts,
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
  outcomeCounts: { all: number } & Record<CycleOutcome, number>;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  moduleOptions: string[];
  engineerOptions: string[];
  portalOptions: string[];
  sprintOptions: string[];
}) {
  const selectCls =
    'rounded-full border border-border bg-[var(--c-surface)] px-3 py-1.5 text-[12.5px] text-[var(--t-1)] outline-none focus:border-[var(--brand-700)] sts-select';
  const labelCls =
    'whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-wide text-[var(--t-3)]';
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-[var(--c-surface)] p-3">
      {/* Row 0 -- Search box + Outcome chips. Search covers title, module,
          feature, ticket and tester, so the keyboard-first way to find a
          cycle is the one typists expect. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2">
        <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:flex-1">
          <i className="ti ti-search pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-[var(--t-3)]" />
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search title, module, feature, ticket or tester…"
            className="w-full rounded-full border border-border bg-[var(--c-surface)] py-1.5 pl-8 pr-3 text-[12.5px] text-[var(--t-1)] outline-none focus:border-[var(--brand-700)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t-3)] hover:text-[var(--t-1)]"
              title="Clear search"
            >
              <i className="ti ti-x text-[12px]" />
            </button>
          )}
        </div>
        <FilterRow label="Outcome" labelCls={labelCls} scroll>
          <FilterChip
            active={outcomeFilter === ''}
            onClick={() => setOutcomeFilter('')}
            label={`All · ${outcomeCounts.all}`}
          />
          {(['Open', 'Pass', 'Fail', 'Blocked'] as const).map(o => (
            <FilterChip
              key={o}
              tone={o === 'Pass' ? 'ok' : o === 'Fail' ? 'err' : o === 'Open' ? 'warn' : 'neutral'}
              active={outcomeFilter === o}
              onClick={() => setOutcomeFilter(outcomeFilter === o ? '' : o)}
              label={`${o} · ${outcomeCounts[o]}`}
            />
          ))}
        </FilterRow>
      </div>

      {/* Row 1 -- Period pills + Sprints dropdown */}
      <FilterRow label="Period" labelCls={labelCls} scroll>
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
          className={cn(selectCls, 'flex-shrink-0')}
        >
          <option value="">Sprints</option>
          {sprintOptions.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {periodMode === 'custom' && (
          <div className="flex flex-shrink-0 items-center gap-2">
            <input
              type="date"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
              className={selectCls}
            />
            <span className="text-[12px] text-[var(--t-3)]">→</span>
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
                className="text-[11.5px] text-[var(--t-3)] underline-offset-2 hover:text-[var(--t-1)] hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </FilterRow>

      {/* Row 2 -- Module / Engineer dropdowns + Portal pills. Every row is a
          fixed label column + its own controls, so everything lines up. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-2.5">
        <FilterRow label="Module" labelCls={labelCls}>
          <select
            value={moduleFilter}
            onChange={e => setModuleFilter(e.target.value)}
            className={cn(selectCls, 'w-full sm:w-auto')}
          >
            <option value="">All modules</option>
            {moduleOptions.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FilterRow>

        <FilterRow label="Engineer" labelCls={labelCls}>
          <select
            value={engineerFilter}
            onChange={e => setEngineerFilter(e.target.value)}
            className={cn(selectCls, 'w-full sm:w-auto')}
          >
            <option value="">All engineers</option>
            {engineerOptions.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FilterRow>

        {portalOptions.length > 0 && (
          <FilterRow label="Portal" labelCls={labelCls} scroll>
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
          </FilterRow>
        )}
      </div>
    </div>
  );
}

// One filter line: a fixed-width label column (so every row's controls start
// at the same x on phones) next to its controls. `scroll` makes the controls
// swipe sideways on phones instead of wrapping; from sm up it's inline + wrapping.
function FilterRow({
  label,
  labelCls,
  scroll,
  children,
}: {
  label: string;
  labelCls: string;
  scroll?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[68px_minmax(0,1fr)] items-center gap-x-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-x-3">
      <span className={labelCls}>{label}</span>
      <div
        className={cn(
          'min-w-0',
          scroll &&
            'chip-scroll flex flex-nowrap items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible',
        )}
      >
        {children}
      </div>
    </div>
  );
}

type ChipTone = 'ok' | 'err' | 'warn' | 'neutral';

// Tinted chip classes per status colour (STS tokens, so dark mode follows).
const CHIP_TONE: Record<ChipTone, { idle: string; on: string }> = {
  ok: {
    idle: 'border-[var(--ok-bdr)] bg-[var(--ok-bg)] text-[var(--ok)] hover:brightness-95',
    on: 'border-[var(--ok)] bg-[var(--ok)] text-white',
  },
  err: {
    idle: 'border-[var(--err-bdr)] bg-[var(--err-bg)] text-[var(--err)] hover:brightness-95',
    on: 'border-[var(--err)] bg-[var(--err)] text-white',
  },
  warn: {
    idle: 'border-[var(--warn-bdr)] bg-[var(--warn-bg)] text-[var(--warn)] hover:brightness-95',
    on: 'border-[var(--warn)] bg-[var(--warn)] text-white',
  },
  neutral: {
    idle: 'border-[var(--neutral-bdr)] bg-[var(--neutral-bg)] text-[var(--neutral)] hover:brightness-95',
    on: 'border-[var(--neutral)] bg-[var(--neutral)] text-white',
  },
};

function FilterChip({
  active,
  onClick,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: ChipTone;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors',
        tone
          ? cn('border', active ? CHIP_TONE[tone].on : CHIP_TONE[tone].idle)
          : active
            ? 'border border-[var(--brand-700)] bg-[var(--brand-700)] text-white'
            : 'border border-border bg-[var(--c-surface)] text-[var(--t-2)] hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]',
      )}
    >
      {label}
    </button>
  );
}

// Outcome -> the redesign's bordered pill (same look as Pass/Fail in the
// other lists): green / red / grey / amber.
function outcomePill(outcome: CycleOutcome): string {
  if (outcome === 'Pass') return 'pill-ok';
  if (outcome === 'Fail') return 'pill-err';
  if (outcome === 'Blocked') return 'pill-neutral';
  return 'pill-warn'; // Open
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
    <div className="overflow-x-auto rounded-xl border border-border bg-[var(--c-surface)]">
      <table className="ql-table w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border bg-[var(--c-bg)] text-[11.5px] uppercase tracking-[0.05em] text-[var(--t-3)]">
            <th className="whitespace-nowrap px-3 py-[11px] text-left font-semibold">Date</th>
            <th className="whitespace-nowrap px-3 py-[11px] text-left font-semibold">
              Portal · Module · Feature
            </th>
            <th className="whitespace-nowrap px-3 py-[11px] text-left font-semibold">Tested by</th>
            <th className="whitespace-nowrap px-3 py-[11px] text-left font-semibold">Env</th>
            <th className="whitespace-nowrap px-3 py-[11px] text-left font-semibold">Type</th>
            <th className="whitespace-nowrap px-3 py-[11px] text-left font-semibold">Ticket</th>
            <th className="whitespace-nowrap px-3 py-[11px] text-left font-semibold">Issues</th>
            <th className="whitespace-nowrap px-3 py-[11px] text-right font-semibold">Open</th>
            <th className="whitespace-nowrap px-3 py-[11px] text-left font-semibold">Outcome</th>
            <th className="whitespace-nowrap px-3 py-[11px] text-right font-semibold" />
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
  const avatars = useUserAvatars();
  const total = c.issueCount ?? 0;
  const open = c.remainingCount ?? Math.max(0, total - (c.doneCount ?? 0));
  const outcome = deriveOutcome(c);
  const tonePill = outcomePill(outcome);
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
      className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-[var(--brand-50)]"
    >
      <td className="ql-date whitespace-nowrap px-3 py-2.5 text-[var(--t-2)]">
        {localDateStr(new Date(c.completedAt ?? c.createdAt))}
      </td>
      <td className="ql-title px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[var(--t-1)]">{c.name || moduleName}</span>
        </div>
        {(c.portalName || c.moduleName || c.featureName || c.version) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {(c.portalName || c.moduleName || c.featureName) && (
              <p className="text-[11.5px] text-[var(--t-3)]">
                {[c.portalName, c.moduleName, c.featureName].filter(Boolean).join(' · ')}
              </p>
            )}
            {c.version && (
              <span
                className="pill pill-brand"
                style={{ padding: '1px 8px', fontSize: 10.5, fontFamily: 'var(--f-mono)' }}
              >
                v{c.version.replace(/^v\s*/i, '')}
              </span>
            )}
          </div>
        )}
      </td>
      <td className="ql-tester whitespace-nowrap px-3 py-2.5" data-label="Tested by">
        {tester ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--t-2)]">
            <PersonAvatar name={tester} avatars={avatars} />
            {tester}
          </span>
        ) : (
          <span className="text-[var(--t-3)]">—</span>
        )}
      </td>
      <td className="ql-env whitespace-nowrap px-3 py-2.5 text-[var(--t-2)]" data-label="Env">
        {c.environment || '—'}
      </td>
      <td className="ql-type whitespace-nowrap px-3 py-2.5 text-[var(--t-2)]" data-label="Type">
        {c.cycleCategory || '—'}
      </td>
      <td
        className="ql-ticket whitespace-nowrap px-3 py-2.5"
        data-label="Ticket"
        onClick={e => e.stopPropagation()}
      >
        {(() => {
          const keys = parseIssueKeys(c.ticketLink);
          if (keys.length === 0) {
            // Nothing parseable: fall back to showing the raw text (not clickable).
            return c.ticketLink ? (
              <span className="font-mono text-[11.5px] text-[var(--t-2)]">{c.ticketLink}</span>
            ) : (
              <span className="text-[var(--t-3)]">—</span>
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
                    className="font-mono text-[11.5px] font-medium text-[#0052CC] hover:text-[#0747A6]"
                  />
                  {i < keys.length - 1 && <span className="text-[var(--t-3)]">,</span>}
                </span>
              ))}
            </span>
          );
        })()}
      </td>
      <td className="ql-issues whitespace-nowrap px-3 py-2.5" data-label="Issues">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-[var(--t-1)]">{total}</span>
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
      <td className="ql-open whitespace-nowrap px-3 py-2.5 text-right" data-label="Open">
        <span className={cn('font-semibold', open > 0 ? 'text-[var(--t-1)]' : 'text-[var(--t-3)]')}>
          {open}
        </span>
      </td>
      <td className="ql-outcome whitespace-nowrap px-3 py-2.5">
        <span className={cn('pill', tonePill)}>{outcome}</span>
      </td>
      <td
        className="ql-actions whitespace-nowrap px-3 py-2.5 text-right"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onEdit}
            title="Edit cycle"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--t-3)] hover:bg-surface-3 hover:text-[var(--t-1)]"
          >
            <i className="ti ti-pencil text-[13px]" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete cycle"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--t-3)] hover:bg-danger-bg hover:text-danger"
          >
            <i className="ti ti-trash text-[13px]" />
          </button>
        </div>
      </td>
    </tr>
  );
}
