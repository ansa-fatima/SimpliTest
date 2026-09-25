'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { avatarColour, cn, initials, relativeTime, severityBadge } from '@/lib/utils';
import { JiraTicketLink, useJiraSiteUrl } from '@/lib/jiraLink';
import { CycleInfoModal } from './CycleInfoModal';
import { Portal, RunResult, Severity } from '@/types';

interface ReportsProps {
  projectId: string | null;
  projectName: string;
  portals: Portal[];
  /** Opens a cycle's detail view — used by the Stability report's log drill-down. */
  onOpenCycle?: (cycleId: string) => void;
  /** Opens straight into this report instead of the tile picker (e.g. Dashboard's "Full stability report" link). */
  initialTab?: 'stability' | 'cycleHistory' | null;
}

type Period = 'today' | '7d' | '30d' | 'sprint' | 'all';
const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'all', label: 'All time' },
];

// Mirrors getPeriodRange('sprint', ...) on the server (app/api/reports/stability/route.ts)
// — kept in sync here purely so the stepper can show/step through a sprint's
// dates instantly, without waiting on a fetch. The server is still the
// actual source of truth for which data points get counted.
const SPRINT_EPOCH_MS = Date.UTC(2026, 8, 3); // confirmed current-sprint start: 2026-09-03
const SPRINT_LENGTH_MS = 14 * 24 * 60 * 60 * 1000;

function sprintRange(offset: number, now: Date): { start: Date; end: Date } {
  const currentIndex = Math.floor((now.getTime() - SPRINT_EPOCH_MS) / SPRINT_LENGTH_MS);
  const start = new Date(SPRINT_EPOCH_MS + (currentIndex + offset) * SPRINT_LENGTH_MS);
  const end = new Date(start.getTime() + SPRINT_LENGTH_MS);
  return { start, end };
}

function formatSprintRange(offset: number): string {
  const { start, end } = sprintRange(offset, new Date());
  const endInclusive = new Date(end.getTime() - 1);
  // Every sprint boundary here is a UTC midnight (see SPRINT_EPOCH_MS) --
  // pin the formatter to UTC too, or a viewer in a timezone ahead of UTC
  // sees Sep 16 23:59:59 UTC rendered as "17 Sep" in their local time,
  // making a sprint that ends Wed 16th look like it ends Thu 17th instead.
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${fmt(start)} – ${fmt(endInclusive)}`;
}

interface Filters {
  portalId: string; // '' = all
  moduleId: string; // '' = all (within the selected portal, if any)
  suiteId: string; // '' = all (within the selected module, if any) — "Feature" in the UI
  version: string; // '' = all — matches TestCycle.version
  tester: string; // '' = all — matches TestRun.executedBy; quick logs aren't attributed yet
  period: Period;
  // Only meaningful when period === 'sprint'. 0 = current sprint, -1 =
  // previous, -2 = the one before that, etc. — lets you page backward
  // through past sprints instead of only ever seeing the current one.
  sprintOffset: number;
}

const DEFAULT_FILTERS: Filters = {
  portalId: '',
  moduleId: '',
  suiteId: '',
  version: '',
  tester: '',
  period: 'all',
  sprintOffset: 0,
};

interface ScopeModule {
  id: string;
  name: string;
  portalId: string;
  suites: { id: string; name: string }[];
}

interface OverviewPayload {
  completedCycles: number;
  avgPassRate: number;
  avgExecutionRate: number;
  avgModuleStability: number;
  openQuickLogIssues: number;
  recurringIssuesTotal: number;
  totalLoggedEntries: number;
}

// Report types available as clickable tiles — the pre-cleanup landing page
// had one tile per report (Execution / Release / Stability); Execution and
// Release were removed as report *content* since Stability (module/feature
// health blended from every quick log and test run) is the one that
// actually gets used day to day, but the tile-grid pattern stays: adding a
// report type back later is just another entry here, not a page rebuild.
interface ReportTypeMeta {
  key: 'stability' | 'cycleHistory' | 'recurringIssues';
  label: string;
  sub: string;
  description: string;
  icon: string;
  iconColor: string;
}
const REPORT_TYPES: ReportTypeMeta[] = [
  {
    key: 'stability',
    label: 'Product Stability',
    sub: 'Module & feature health',
    description:
      'Is the product actually getting more stable, module by module? Blends case runs and quick logs into one score.',
    icon: 'ti-shield-check',
    iconColor: 'bg-indigo-100 text-indigo-700',
  },
  {
    key: 'recurringIssues',
    label: 'Issue Tracking',
    sub: 'The stuff that keeps coming back',
    description: 'What keeps coming back instead of getting fixed for good — repeat failures.',
    icon: 'ti-repeat',
    iconColor: 'bg-amber-100 text-amber-700',
  },
  {
    key: 'cycleHistory',
    label: 'Cycle History',
    sub: 'Every cycle, filterable',
    description:
      'Every case-based run and quick log, in one filterable log — replaces the old Execution and Release reports.',
    icon: 'ti-list-details',
    iconColor: 'bg-blue-100 text-blue-700',
  },
];

export function Reports({
  projectId,
  projectName,
  portals,
  onOpenCycle,
  initialTab,
}: ReportsProps) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  // Nothing selected on arrival — the tiles are a picker, not a tab bar that
  // has to always show something, so landing on Reports shows the choice
  // first and only opens a report once one is actually clicked. A caller
  // can skip straight past the picker by passing initialTab (e.g. Dashboard's
  // "Full stability report" link).
  const [activeTab, setActiveTab] = useState<ReportTypeMeta['key'] | null>(initialTab ?? null);

  // The active report's CSV export lives in a ref, not state -- each report
  // component registers its own handler (it owns the data the export needs)
  // on every render; a ref lets that happen without bouncing this parent
  // through a re-render loop the way lifting it into state would.
  const csvHandlerRef = useRef<() => void>(() => {});

  // Feeds the Module/Feature cascade and the Tester/Version dropdowns —
  // fetched once per project, independent of each report's own data fetch.
  const [modules, setModules] = useState<ScopeModule[]>([]);
  const [testers, setTesters] = useState<string[]>([]);
  const [versions, setVersions] = useState<string[]>([]);
  useEffect(() => {
    if (!projectId) return;
    api
      .get<ScopeModule[]>(`/api/modules?projectId=${projectId}`)
      .then(setModules)
      .catch(e => console.error('[reports modules]', e));
    api
      .get<{ items: { name: string; username: string }[] }>(`/api/members?projectId=${projectId}`)
      .then(({ items }) => setTesters(items.map(m => m.name || m.username).filter(Boolean)))
      .catch(e => console.error('[reports members]', e));
    api
      .get<{ version: string | null }[]>(`/api/cycles?projectId=${projectId}`)
      .then(cycles =>
        setVersions(
          Array.from(new Set(cycles.map(c => c.version).filter((v): v is string => !!v))),
        ),
      )
      .catch(e => console.error('[reports versions]', e));
  }, [projectId]);

  // Landing-page "At a Glance" numbers + each report card's highlight stat —
  // fetched once per project, independent of which report (if any) is open.
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  useEffect(() => {
    if (!projectId) return;
    api
      .get<OverviewPayload>(`/api/reports/overview?projectId=${projectId}`)
      .then(setOverview)
      .catch(e => console.error('[reports overview]', e));
  }, [projectId]);

  const visibleModules = filters.portalId
    ? modules.filter(m => m.portalId === filters.portalId)
    : modules;
  const visibleSuites = filters.moduleId
    ? (modules.find(m => m.id === filters.moduleId)?.suites ?? [])
    : [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-44 py-6">
        {activeTab === null ? (
          <>
            {/* Header */}
            <div className="mb-5">
              <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">
                Analytics
              </h1>
              <p className="text-[13px] text-text-2">
                Three reports cover it all: is the product stable, what keeps coming back, and what
                happened along the way.
              </p>
            </div>

            {/* At a Glance */}
            <p className="mb-2 text-[12.5px] font-semibold text-text">At a Glance</p>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <GlanceCard
                icon="ti-rotate-clockwise"
                iconColor="bg-indigo-100 text-indigo-700"
                value={overview?.completedCycles ?? 0}
                label="Completed Cycles"
              />
              <GlanceCard
                icon="ti-circle-check"
                iconColor="bg-emerald-100 text-emerald-700"
                value={`${overview?.avgPassRate ?? 0}%`}
                label="Avg Pass Rate"
              />
              <GlanceCard
                icon="ti-player-play"
                iconColor="bg-primary-light text-primary-text"
                value={`${overview?.avgExecutionRate ?? 0}%`}
                label="Avg Execution Rate"
              />
              <GlanceCard
                icon="ti-shield-check"
                iconColor="bg-blue-100 text-blue-700"
                value={`${overview?.avgModuleStability ?? 0}%`}
                label="Avg Module Stability"
              />
              <GlanceCard
                icon="ti-alert-circle"
                iconColor="bg-red-100 text-red-700"
                value={overview?.openQuickLogIssues ?? 0}
                label="Open Quick-Log Issues"
              />
              <GlanceCard
                icon="ti-repeat"
                iconColor="bg-amber-100 text-amber-700"
                value={overview?.recurringIssuesTotal ?? 0}
                label="Issue Tracking"
              />
            </div>

            {/* Jump to a Report */}
            <p className="mb-2 text-[12.5px] font-semibold text-text">Jump to a Report</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {REPORT_TYPES.map(rt => (
                <ReportJumpCard
                  key={rt.key}
                  meta={rt}
                  statValue={
                    rt.key === 'stability'
                      ? `${overview?.avgModuleStability ?? 0}%`
                      : rt.key === 'recurringIssues'
                        ? String(overview?.recurringIssuesTotal ?? 0)
                        : String(overview?.totalLoggedEntries ?? 0)
                  }
                  statLabel={
                    rt.key === 'stability'
                      ? 'avg. module stability'
                      : rt.key === 'recurringIssues'
                        ? 'recurring cases + reopened tickets'
                        : 'total logged entries'
                  }
                  onClick={() => setActiveTab(rt.key)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-[12px] text-text-3">
              <button type="button" onClick={() => setActiveTab(null)} className="hover:text-text">
                Analytics
              </button>
              <span>/</span>
              <span className="font-medium text-text">
                {REPORT_TYPES.find(rt => rt.key === activeTab)?.label}
              </span>
            </div>

            {/* Report name heading */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] text-text">
                  {REPORT_TYPES.find(rt => rt.key === activeTab)?.label}
                </h1>
                <p className="mt-1 text-[13px] text-text-2">
                  {REPORT_TYPES.find(rt => rt.key === activeTab)?.description}
                </p>
              </div>
              <ExportButtons onCsv={() => csvHandlerRef.current()} />
            </div>

            {/* Filters card */}
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="mb-3 flex items-center gap-1.5 text-[12.5px] font-semibold text-text">
                <i className="ti ti-filter text-[14px] text-text-3" />
                Filters
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <FilterField label="Portal">
                  <select
                    value={filters.portalId}
                    onChange={e =>
                      // Changing Portal drops Module/Feature — they're only
                      // ever options *within* a portal, so keeping a stale
                      // selection from a different one would silently scope
                      // the report to a module that isn't even shown as picked.
                      setFilters(f => ({
                        ...f,
                        portalId: e.target.value,
                        moduleId: '',
                        suiteId: '',
                      }))
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                  >
                    <option value="">All Portals</option>
                    {portals.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Module">
                  <select
                    value={filters.moduleId}
                    onChange={e =>
                      setFilters(f => ({ ...f, moduleId: e.target.value, suiteId: '' }))
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                  >
                    <option value="">All Modules</option>
                    {visibleModules.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Feature / Suite">
                  <select
                    value={filters.suiteId}
                    onChange={e => setFilters(f => ({ ...f, suiteId: e.target.value }))}
                    disabled={!filters.moduleId}
                    className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-surface-2 disabled:text-text-3"
                  >
                    <option value="">
                      {filters.moduleId ? 'All Suites' : 'Pick a module first'}
                    </option>
                    {visibleSuites.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Version">
                  <select
                    value={filters.version}
                    onChange={e => setFilters(f => ({ ...f, version: e.target.value }))}
                    className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                  >
                    <option value="">All Versions</option>
                    {versions.map(v => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Tester">
                  <select
                    value={filters.tester}
                    onChange={e => setFilters(f => ({ ...f, tester: e.target.value }))}
                    className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                  >
                    <option value="">Everyone</option>
                    {testers.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Date Range">
                  <select
                    value={filters.period}
                    onChange={e =>
                      setFilters(f => ({
                        ...f,
                        period: e.target.value as Period,
                        sprintOffset: 0,
                      }))
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                  >
                    {PERIOD_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {filters.period === 'sprint' && (
                    <div className="mt-1.5 flex items-center justify-between gap-1 rounded border border-border bg-surface-2 px-1.5 py-1">
                      <button
                        type="button"
                        title="Previous sprint"
                        onClick={() =>
                          setFilters(f => ({ ...f, sprintOffset: f.sprintOffset - 1 }))
                        }
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-2 hover:bg-surface-3"
                      >
                        <i className="ti ti-chevron-left text-[13px]" />
                      </button>
                      <span
                        className="truncate text-[11.5px] font-medium text-text"
                        title={formatSprintRange(filters.sprintOffset)}
                      >
                        {formatSprintRange(filters.sprintOffset)}
                        {filters.sprintOffset === 0 && (
                          <span className="ml-1 font-normal text-text-3">(current)</span>
                        )}
                      </span>
                      <button
                        type="button"
                        title="Next sprint"
                        disabled={filters.sprintOffset >= 0}
                        onClick={() =>
                          setFilters(f => ({ ...f, sprintOffset: Math.min(0, f.sprintOffset + 1) }))
                        }
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-2 hover:bg-surface-3 disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <i className="ti ti-chevron-right text-[13px]" />
                      </button>
                    </div>
                  )}
                </FilterField>
              </div>

              {(filters.portalId ||
                filters.moduleId ||
                filters.suiteId ||
                filters.version ||
                filters.tester ||
                filters.period !== 'all') && (
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="mt-3 rounded border border-dashed border-border px-2 py-1 text-[11px] text-text-3 hover:bg-surface-2"
                >
                  Reset filters
                </button>
              )}
            </div>

            {/* Report content */}
            <section className="min-w-0 flex-1">
              {activeTab === 'stability' && (
                <StabilityReport
                  projectId={projectId}
                  projectName={projectName}
                  filters={filters}
                  onOpenCycle={onOpenCycle}
                  onCsvReady={fn => {
                    csvHandlerRef.current = fn;
                  }}
                />
              )}
              {activeTab === 'cycleHistory' && (
                <CycleHistoryReport
                  projectId={projectId}
                  filters={filters}
                  onCsvReady={fn => {
                    csvHandlerRef.current = fn;
                  }}
                />
              )}
              {activeTab === 'recurringIssues' && (
                <RecurringIssuesReport
                  projectId={projectId}
                  filters={filters}
                  onCsvReady={fn => {
                    csvHandlerRef.current = fn;
                  }}
                />
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reports landing page ────────────────────────────────────

function GlanceCard({
  icon,
  iconColor,
  value,
  label,
}: {
  icon: string;
  iconColor: string;
  value: number | string;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <span
        className={cn(
          'mb-2.5 inline-flex h-8 w-8 items-center justify-center rounded-lg',
          iconColor,
        )}
      >
        <i className={cn('ti', icon, 'text-[16px]')} />
      </span>
      <p className="text-[20px] font-semibold leading-tight text-text">{value}</p>
      <p className="mt-0.5 text-[11.5px] text-text-3">{label}</p>
    </div>
  );
}

function ReportJumpCard({
  meta,
  statValue,
  statLabel,
  onClick,
}: {
  meta: ReportTypeMeta;
  statValue: string;
  statLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col rounded-lg border border-border bg-surface p-5 text-left transition-colors hover:border-primary hover:shadow-sm"
    >
      <div className="mb-3 flex items-start justify-between">
        <span
          className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
            meta.iconColor,
          )}
        >
          <i className={cn('ti', meta.icon, 'text-[20px]')} />
        </span>
        <i className="ti ti-chevron-right flex-shrink-0 text-[16px] text-text-3 transition-transform group-hover:translate-x-0.5" />
      </div>
      <h3 className="text-[15px] font-semibold text-text">{meta.label}</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-text-3">{meta.description}</p>
      <div className="mt-4 border-t border-border pt-3">
        <span className="text-[15px] font-semibold text-primary-text">{statValue}</span>
        <span className="ml-1.5 text-[11.5px] text-text-3">{statLabel}</span>
      </div>
    </button>
  );
}

// ─── Filter sidebar bits ────────────────────────────────────

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-3">
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Report header (title strip + CSV/PDF/Share) ────────────

function ExportButtons({ onCsv }: { onCsv: () => void }) {
  const [shared, setShared] = useState(false);
  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={onCsv}
        className="inline-flex items-center gap-1 rounded-[7px] border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-2"
      >
        <i className="ti ti-file-spreadsheet text-[14px]" />
        CSV
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1 rounded-[7px] border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-2"
      >
        <i className="ti ti-file-text text-[14px]" />
        PDF
      </button>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(window.location.href);
          setShared(true);
          setTimeout(() => setShared(false), 1800);
        }}
        className="inline-flex items-center gap-1 rounded-[7px] bg-primary px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-primary-hover"
      >
        <i className={cn('ti', shared ? 'ti-check' : 'ti-share', 'text-[14px]')} />
        {shared ? 'Copied!' : 'Share'}
      </button>
    </div>
  );
}

// ─── Stability report ───────────────────────────────────────

interface StabilityLog {
  cycleId: string;
  cycleName: string;
  kind: 'quicklog' | 'caserun';
  label: string;
  detail: string;
  pass: boolean;
  score: number;
  ts: string;
}
interface StabilityNode {
  id: string;
  name: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  label: 'Stable' | 'At Risk' | 'Unstable' | 'No data';
  trend: 'up' | 'down' | 'flat';
  lastActivity: string | null;
  logs: StabilityLog[];
}
interface StabilityModule extends StabilityNode {
  suites: StabilityNode[];
}
interface StabilityPayload {
  portals: {
    id: string;
    name: string;
    icon: string | null;
    modules: StabilityModule[];
  }[];
  totals: {
    totalDataPoints: number;
    overallPassRate: number;
    modules: { stable: number; atRisk: number; unstable: number; noData: number };
  };
  period: Period;
  periodStart: string | null;
  periodEnd: string | null;
}

function StabilityReport({
  projectId,
  projectName,
  filters,
  onOpenCycle,
  onCsvReady,
}: {
  projectId: string | null;
  projectName: string;
  filters: Filters;
  onOpenCycle?: (cycleId: string) => void;
  onCsvReady: (fn: () => void) => void;
}) {
  const [data, setData] = useState<StabilityPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [panelFor, setPanelFor] = useState<{ breadcrumb: string; node: StabilityNode } | null>(
    null,
  );

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    params.set('period', filters.period);
    if (filters.period === 'sprint') params.set('sprintOffset', String(filters.sprintOffset));
    if (filters.portalId) params.set('portalId', filters.portalId);
    if (filters.moduleId) params.set('moduleId', filters.moduleId);
    if (filters.suiteId) params.set('suiteId', filters.suiteId);
    if (filters.version) params.set('version', filters.version);
    if (filters.tester) params.set('tester', filters.tester);
    setLoading(true);
    api
      .get<StabilityPayload>(`/api/reports/stability?${params.toString()}`)
      .then(setData)
      .catch(e => console.error('[stability report]', e))
      .finally(() => setLoading(false));
  }, [
    projectId,
    filters.period,
    filters.sprintOffset,
    filters.portalId,
    filters.moduleId,
    filters.suiteId,
    filters.version,
    filters.tester,
  ]);

  // The server now does the real scoping (Portal/Module/Feature/Tester are
  // all sent as query params above), so `data.portals` already reflects
  // exactly what's selected — no client-side re-filtering needed, and none
  // of the KPI cards below can silently disagree with the row list again.
  const portalsToShow = data?.portals ?? [];

  // Overview panel numbers -- derived from the same scoped `data.portals`
  // the tree below renders, so the donut/coverage list can never disagree
  // with what the drill-down shows for the current filters.
  let totalPassed = 0;
  let totalFailed = 0;
  const coverageModules: {
    name: string;
    portalName: string;
    total: number;
    passed: number;
    passRate: number;
    label: StabilityNode['label'];
  }[] = [];
  for (const p of portalsToShow) {
    for (const m of p.modules) {
      totalPassed += m.passed;
      totalFailed += m.failed;
      if (m.total > 0) {
        coverageModules.push({
          name: m.name,
          portalName: p.name,
          total: m.total,
          passed: m.passed,
          passRate: m.passRate,
          label: m.label,
        });
      }
    }
  }
  coverageModules.sort((a, b) => b.total - a.total);
  const topCoverageModules = coverageModules.slice(0, 8);

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onCsv = () => {
    if (!data) return;
    const rows: (string | number)[][] = [
      ['Portal', 'Module', 'Feature', 'Total', 'Passed', 'Failed', 'Pass rate', 'Health', 'Trend'],
    ];
    for (const p of portalsToShow) {
      for (const m of p.modules) {
        rows.push([
          p.name,
          m.name,
          '',
          m.total,
          m.passed,
          m.failed,
          `${m.passRate}%`,
          m.label,
          m.trend,
        ]);
        for (const s of m.suites) {
          rows.push([
            p.name,
            m.name,
            s.name,
            s.total,
            s.passed,
            s.failed,
            `${s.passRate}%`,
            s.label,
            s.trend,
          ]);
        }
      }
    }
    downloadCsv(`stability-${projectName.toLowerCase().replace(/\s+/g, '-')}.csv`, rows);
  };

  useEffect(() => {
    onCsvReady(onCsv);
  });

  return (
    <div>
      {!loading && totalPassed + totalFailed > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.15fr_1fr]">
          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="text-[13.5px] font-semibold text-text">Coverage by module</h3>
            <p className="mb-3.5 mt-0.5 text-[11.5px] text-text-3">
              Pass rate per module · widest first
            </p>
            <div className="flex flex-col gap-3">
              {topCoverageModules.map((row, i) => (
                <ModuleCoverageRow key={`${row.portalName}-${row.name}-${i}`} row={row} />
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="text-[13.5px] font-semibold text-text">Pass / fail split</h3>
            <p className="mb-3.5 mt-0.5 text-[11.5px] text-text-3">
              {(totalPassed + totalFailed).toLocaleString()} data points
            </p>
            <PassFailDonut passed={totalPassed} failed={totalFailed} />
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="mt-4 rounded-lg border border-border bg-surface p-8 text-center text-text-3">
          Loading…
        </div>
      ) : portalsToShow.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface p-8 text-center text-text-3">
          No portals to show.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {portalsToShow.map(p => (
            <div key={p.id} className="rounded-lg border border-border bg-surface">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <i
                  className={cn(
                    'ti',
                    p.icon && p.icon.startsWith('ti-') ? p.icon : 'ti-app-window',
                    'text-[16px] text-text-3',
                  )}
                />
                <span className="text-[13px] font-semibold text-text">{p.name}</span>
              </div>
              <div className="divide-y divide-border">
                {p.modules.length === 0 && (
                  <p className="px-4 py-3 text-[12px] italic text-text-3">No modules</p>
                )}
                {p.modules.map(m => (
                  <div key={m.id}>
                    <div className="flex w-full items-center justify-between gap-3 px-4 py-2.5">
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        {m.suites.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggle(m.id)}
                            aria-label={expanded.has(m.id) ? 'Collapse' : 'Expand'}
                            className="flex-shrink-0 rounded p-0.5 hover:bg-surface-2"
                          >
                            <i
                              className={cn(
                                'ti ti-chevron-right text-[12px] text-text-3 transition-transform',
                                expanded.has(m.id) && 'rotate-90',
                              )}
                            />
                          </button>
                        ) : (
                          <span className="w-[20px] flex-shrink-0" />
                        )}
                        <button
                          type="button"
                          onClick={() => setPanelFor({ breadcrumb: p.name, node: m })}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left hover:underline"
                        >
                          <i className="ti ti-folder flex-shrink-0 text-[13px] text-text-3" />
                          <span className="truncate text-[12.5px] font-medium text-text">
                            {m.name}
                          </span>
                          <StabilityBadge label={m.label} />
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={m.total === 0}
                        onClick={() => setPanelFor({ breadcrumb: p.name, node: m })}
                        title={m.total > 0 ? `View ${m.total} contributing log(s)` : undefined}
                        className={cn(
                          'flex-shrink-0 rounded px-1 py-0.5',
                          m.total > 0 && 'cursor-pointer hover:bg-surface-2',
                        )}
                      >
                        <StabilityStats node={m} />
                      </button>
                    </div>
                    {expanded.has(m.id) && (
                      <div className="divide-y divide-border bg-surface-2/40 pl-8">
                        {m.suites.map(s => (
                          <div
                            key={s.id}
                            className="flex items-center justify-between gap-3 px-4 py-2"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setPanelFor({ breadcrumb: `${p.name} › ${m.name}`, node: s })
                              }
                              className="flex min-w-0 items-center gap-2 text-left hover:underline"
                            >
                              <i className="ti ti-list-details text-[12px] text-text-3" />
                              <span className="truncate text-[12px] text-text">{s.name}</span>
                              <StabilityBadge label={s.label} />
                            </button>
                            <button
                              type="button"
                              disabled={s.total === 0}
                              onClick={() =>
                                setPanelFor({ breadcrumb: `${p.name} › ${m.name}`, node: s })
                              }
                              title={
                                s.total > 0 ? `View ${s.total} contributing log(s)` : undefined
                              }
                              className={cn(
                                'flex-shrink-0 rounded px-1 py-0.5',
                                s.total > 0 && 'cursor-pointer hover:bg-surface-2',
                              )}
                            >
                              <StabilityStats node={s} compact />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {panelFor && (
        <StabilityDrilldownPanel
          breadcrumb={panelFor.breadcrumb}
          node={panelFor.node}
          onClose={() => setPanelFor(null)}
        />
      )}
    </div>
  );
}

// Buckets a node's chronological logs into up to `maxBuckets` groups and
// returns each group's pass rate — cheap client-side trend line, no new
// endpoint needed since the report already returns every log with a ts.
function bucketPassRates(logs: StabilityLog[], maxBuckets = 8): number[] {
  if (logs.length < 2) return [];
  const sorted = [...logs].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const n = Math.min(maxBuckets, sorted.length);
  const size = Math.ceil(sorted.length / n);
  const out: number[] = [];
  for (let i = 0; i < sorted.length; i += size) {
    const chunk = sorted.slice(i, i + size);
    out.push(Math.round((chunk.reduce((sum, l) => sum + l.score, 0) / chunk.length) * 100));
  }
  return out;
}

function StabilityDrilldownPanel({
  breadcrumb,
  node,
  onClose,
}: {
  breadcrumb: string;
  node: StabilityNode;
  onClose: () => void;
}) {
  const trendPoints = useMemo(() => bucketPassRates(node.logs), [node.logs]);

  // Group data points by their cycle — one row per test cycle or quick log,
  // not per test case, so a regression run with 12 cases shows up once
  // instead of 12 times. A cycle counts as passing only if every one of its
  // grouped data points passed.
  const cyclesList = useMemo(() => {
    const groups = new Map<
      string,
      {
        cycleId: string;
        cycleName: string;
        kind: 'quicklog' | 'caserun';
        count: number;
        failCount: number;
        detail: string;
        latestTs: string;
      }
    >();
    for (const l of node.logs) {
      const g = groups.get(l.cycleId);
      if (g) {
        g.count++;
        if (!l.pass) g.failCount++;
        if (new Date(l.ts) > new Date(g.latestTs)) {
          g.latestTs = l.ts;
          g.detail = l.detail;
        }
      } else {
        groups.set(l.cycleId, {
          cycleId: l.cycleId,
          cycleName: l.cycleName,
          kind: l.kind,
          count: 1,
          failCount: l.pass ? 0 : 1,
          detail: l.detail,
          latestTs: l.ts,
        });
      }
    }
    return Array.from(groups.values())
      .map(g => ({ ...g, pass: g.failCount === 0 }))
      .sort((a, b) => new Date(b.latestTs).getTime() - new Date(a.latestTs).getTime());
  }, [node.logs]);
  const failingCount = cyclesList.filter(g => !g.pass).length;

  const chartColor =
    node.label === 'Stable'
      ? 'text-emerald-600'
      : node.label === 'At Risk'
        ? 'text-amber-600'
        : node.label === 'Unstable'
          ? 'text-red-600'
          : 'text-text-3';

  const linePoints = trendPoints
    .map((v, i) => {
      const x = trendPoints.length === 1 ? 190 : 15 + (350 * i) / (trendPoints.length - 1);
      const y = 95 - (v / 100) * 80;
      return `${x},${y}`;
    })
    .join(' ');
  const areaPoints = trendPoints.length >= 2 ? `${linePoints} 365,95 15,95` : '';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-[420px] flex-col overflow-hidden border-l border-border bg-surface shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-text-3">{breadcrumb}</span>
            <button
              type="button"
              onClick={onClose}
              className="flex-shrink-0 rounded p-1 text-text-3 hover:bg-surface-2 hover:text-text"
            >
              <i className="ti ti-x text-[16px]" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="truncate text-[16px] font-semibold text-text">{node.name}</span>
            <StabilityBadge label={node.label} />
          </div>
        </div>

        <div className="border-b border-border px-5 py-4">
          {node.total === 0 ? (
            <p className="text-[12px] text-text-3">No data yet for this module.</p>
          ) : (
            <>
              <div className="mb-0.5 flex items-baseline gap-2.5">
                <span className="text-[26px] font-semibold text-text">{node.passRate}%</span>
                <span
                  className={cn(
                    'flex items-center gap-1 text-[12px]',
                    node.trend === 'up'
                      ? 'text-emerald-600'
                      : node.trend === 'down'
                        ? 'text-red-600'
                        : 'text-text-3',
                  )}
                >
                  <i
                    className={cn(
                      'ti',
                      node.trend === 'up'
                        ? 'ti-trending-up'
                        : node.trend === 'down'
                          ? 'ti-trending-down'
                          : 'ti-minus',
                    )}
                  />
                  {node.trend === 'up' ? 'improving' : node.trend === 'down' ? 'declining' : 'flat'}
                </span>
              </div>
              <p className="mb-3 text-[12px] text-text-3">
                {node.passed} passed / {node.failed} failed · {node.total} data point
                {node.total === 1 ? '' : 's'}
              </p>

              {trendPoints.length >= 2 && (
                <svg viewBox="0 0 380 110" className="h-[90px] w-full">
                  <line
                    x1="15"
                    y1="23"
                    x2="365"
                    y2="23"
                    stroke="currentColor"
                    className="text-text-3"
                    strokeOpacity={0.3}
                    strokeDasharray="3,3"
                  />
                  <text x="368" y="26" fill="currentColor" className="text-text-3" fontSize="9">
                    90%
                  </text>
                  <line
                    x1="15"
                    y1="39"
                    x2="365"
                    y2="39"
                    stroke="currentColor"
                    className="text-text-3"
                    strokeOpacity={0.3}
                    strokeDasharray="3,3"
                  />
                  <text x="368" y="42" fill="currentColor" className="text-text-3" fontSize="9">
                    70%
                  </text>
                  <polygon
                    className={chartColor}
                    fill="currentColor"
                    fillOpacity={0.08}
                    points={areaPoints}
                  />
                  <polyline
                    className={chartColor}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    points={linePoints}
                  />
                </svg>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-5 pb-1.5 pt-3">
          <span className="text-[12px] font-semibold text-text">Cycles ({cyclesList.length})</span>
          {cyclesList.length > 0 && (
            <span className="text-[11px] text-text-3">
              {failingCount > 0 ? `${failingCount} failing · ` : ''}newest first
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto pb-2">
          {cyclesList.length === 0 ? (
            <p className="px-5 py-6 text-center text-[12px] text-text-3">
              No cycles logged against this module yet.
            </p>
          ) : (
            cyclesList.map(g => (
              <div key={g.cycleId} className="flex w-full items-center gap-2.5 px-5 py-2.5">
                <i
                  className={cn(
                    'flex-shrink-0 text-[15px]',
                    g.pass ? 'ti ti-circle-check text-emerald-600' : 'ti ti-circle-x text-red-600',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium text-text">
                      {g.cycleName}
                    </span>
                    <span
                      className={cn(
                        'flex-shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                        g.kind === 'caserun'
                          ? 'bg-primary-light text-primary'
                          : 'bg-slate-100 text-slate-500',
                      )}
                    >
                      {g.kind === 'caserun' ? 'Test run' : 'Quick log'}
                    </span>
                  </div>
                  <div className="truncate text-[10.5px] text-text-3">
                    {g.kind === 'caserun'
                      ? g.pass
                        ? `${g.count} case${g.count === 1 ? '' : 's'} passed`
                        : `${g.failCount} of ${g.count} case${g.count === 1 ? '' : 's'} failed`
                      : g.detail}
                  </div>
                </div>
                <span className="flex-shrink-0 text-[10.5px] text-text-3">
                  {relativeTime(g.latestTs)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StabilityBadge({ label }: { label: StabilityNode['label'] }) {
  const cls =
    label === 'Stable'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : label === 'At Risk'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : label === 'Unstable'
          ? 'bg-red-50 text-red-700 ring-red-200'
          : 'bg-slate-100 text-slate-500 ring-slate-200';
  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1',
        cls,
      )}
    >
      {label}
    </span>
  );
}

function StabilityStats({ node, compact }: { node: StabilityNode; compact?: boolean }) {
  if (node.total === 0) {
    return <span className="flex-shrink-0 text-[11px] text-text-3">No data yet</span>;
  }
  const trendIcon =
    node.trend === 'up'
      ? 'ti-trending-up'
      : node.trend === 'down'
        ? 'ti-trending-down'
        : 'ti-minus';
  const trendColor =
    node.trend === 'up'
      ? 'text-emerald-600'
      : node.trend === 'down'
        ? 'text-red-600'
        : 'text-text-3';
  return (
    <div className="flex flex-shrink-0 items-center gap-3">
      {!compact && (
        <span className="text-[11px] text-text-3">
          {node.passed}/{node.total} passed
        </span>
      )}
      <i
        className={cn('ti', trendIcon, trendColor, 'text-[13px]')}
        title={`Trend: ${node.trend}`}
      />
      <span
        className={cn(
          'w-9 text-right text-[12px] font-semibold',
          node.passRate >= 90
            ? 'text-emerald-700'
            : node.passRate >= 70
              ? 'text-amber-700'
              : 'text-red-700',
        )}
      >
        {node.passRate}%
      </span>
      <span className="w-16 flex-shrink-0 text-right text-[10.5px] text-text-3">
        {node.lastActivity ? relativeTime(node.lastActivity) : '—'}
      </span>
    </div>
  );
}

// ─── Cycle History report ────────────────────────────────────

interface CycleHistoryRow {
  id: string;
  name: string;
  mode: 'CaseBased' | 'Manual';
  portalName: string | null;
  moduleName: string | null;
  scopeName: string | null;
  version: string | null;
  environment: string | null;
  tester: string;
  date: string;
  issueCount: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  doneCount: number;
  remainingCount: number;
  /** null = not applicable (an unsynced case-based cycle's breakdown comes from runs[]). */
  reopenedCount: number | null;
}
interface CycleHistoryPayload {
  cycles: CycleHistoryRow[];
  totals: {
    totalCycles: number;
    totalIssues: number;
    quickLogCount: number;
    testRunCount: number;
  };
}

type CycleHistoryModeFilter = 'all' | 'CaseBased' | 'Manual';

function CycleHistoryReport({
  projectId,
  filters,
  onCsvReady,
}: {
  projectId: string | null;
  filters: Filters;
  onCsvReady: (fn: () => void) => void;
}) {
  const [data, setData] = useState<CycleHistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [modeFilter, setModeFilter] = useState<CycleHistoryModeFilter>('all');
  const [viewingCycleId, setViewingCycleId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    params.set('period', filters.period);
    if (filters.period === 'sprint') params.set('sprintOffset', String(filters.sprintOffset));
    if (filters.portalId) params.set('portalId', filters.portalId);
    if (filters.moduleId) params.set('moduleId', filters.moduleId);
    if (filters.suiteId) params.set('suiteId', filters.suiteId);
    if (filters.version) params.set('version', filters.version);
    if (filters.tester) params.set('tester', filters.tester);
    setLoading(true);
    api
      .get<CycleHistoryPayload>(`/api/reports/cycle-history?${params.toString()}`)
      .then(setData)
      .catch(e => console.error('[cycle history report]', e))
      .finally(() => setLoading(false));
  }, [
    projectId,
    filters.period,
    filters.sprintOffset,
    filters.portalId,
    filters.moduleId,
    filters.suiteId,
    filters.version,
    filters.tester,
  ]);

  // A cycle scoped exactly at Portal or Module level has its own scopeName
  // equal to that same portal/module -- dedupe by value so "Web / Payments"
  // doesn't render as "Web › Payments › Payments".
  const scopePath = (c: CycleHistoryRow) =>
    [c.portalName, c.moduleName, c.scopeName]
      .filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i)
      .join(' › ');

  const visibleCycles = (data?.cycles ?? []).filter(
    c => modeFilter === 'all' || c.mode === modeFilter,
  );

  const onCsv = () => {
    if (!data) return;
    const rows: (string | number)[][] = [
      [
        'Cycle',
        'Date',
        'Portal-Module-Feature',
        'Version',
        'Environment',
        'Total Issues',
        'Critical',
        'Major',
        'Minor',
        'Done',
        'Remaining',
        'Progress %',
        'Reopened',
        'Tester',
      ],
    ];
    for (const c of visibleCycles) {
      rows.push([
        c.name,
        new Date(c.date).toLocaleDateString('en-GB'),
        scopePath(c),
        c.version ?? '',
        c.environment ?? '',
        c.issueCount,
        c.criticalCount,
        c.majorCount,
        c.minorCount,
        c.doneCount,
        c.remainingCount,
        c.issueCount === 0 ? 0 : Math.round((c.doneCount / c.issueCount) * 100),
        c.reopenedCount ?? '',
        c.tester || 'Unattributed',
      ]);
    }
    downloadCsv('cycle-history.csv', rows);
  };

  useEffect(() => {
    onCsvReady(onCsv);
  });

  const allCount = data?.cycles.length ?? 0;
  const testRunCount = data?.totals.testRunCount ?? 0;
  const quickLogCount = data?.totals.quickLogCount ?? 0;

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 border-b border-border">
        {[
          { key: 'all' as const, label: 'All', count: allCount },
          { key: 'CaseBased' as const, label: 'Test Runs', count: testRunCount },
          { key: 'Manual' as const, label: 'Quick Logs', count: quickLogCount },
        ].map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setModeFilter(t.key)}
            className={cn(
              'relative inline-flex items-center gap-1.5 px-1 pb-2.5 text-[13.5px] font-medium transition-colors',
              modeFilter === t.key ? 'text-text' : 'text-text-3 hover:text-text-2',
            )}
          >
            {t.label}
            <span
              className={cn(
                'rounded-full px-1.5 py-px text-[10.5px]',
                modeFilter === t.key
                  ? 'bg-primary-light text-primary-text'
                  : 'bg-surface-2 text-text-3',
              )}
            >
              {t.count}
            </span>
            {modeFilter === t.key && (
              <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-text-3">
          Loading…
        </div>
      ) : visibleCycles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-text-3">
          No cycles match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-[12px]">
            <thead className="bg-surface-2">
              <tr>
                <Th>Cycle</Th>
                <Th>Date</Th>
                <Th>Portal-Module-Feature</Th>
                <Th>Version</Th>
                <Th>Environment</Th>
                <Th align="right">Total Issues</Th>
                <Th align="right">Critical</Th>
                <Th align="right">Major</Th>
                <Th align="right">Minor</Th>
                <Th>Progress</Th>
                <Th align="right">Reopened</Th>
                <Th>Tester</Th>
              </tr>
            </thead>
            <tbody>
              {visibleCycles.map(c => {
                const percent =
                  c.issueCount === 0 ? 0 : Math.round((c.doneCount / c.issueCount) * 100);
                return (
                  <tr
                    key={c.id}
                    onClick={() => setViewingCycleId(c.id)}
                    className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-2"
                  >
                    <td
                      className="max-w-[220px] truncate px-3 py-2 font-medium text-text"
                      title={c.name}
                    >
                      {c.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-2">
                      {new Date(c.date).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-3 py-2 text-text-2">
                      {scopePath(c) || <span className="text-text-3">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-text-2">
                      {c.version || <span className="text-text-3">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-2">
                      {c.environment || <span className="text-text-3">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text">
                      {c.issueCount || <span className="text-text-3">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-danger">
                      {c.criticalCount || <span className="text-text-3">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-warning">
                      {c.majorCount || <span className="text-text-3">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-2">
                      {c.minorCount || <span className="text-text-3">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {c.issueCount === 0 ? (
                        <span className="text-text-3">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 flex-shrink-0 overflow-hidden rounded-full bg-surface-3">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                percent === 100 ? 'bg-success' : 'bg-primary',
                              )}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-text-2">{percent}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-warning">
                      {c.reopenedCount === null ? (
                        <span className="text-text-3">—</span>
                      ) : (
                        c.reopenedCount || <span className="text-text-3">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-2">
                      {c.tester || <span className="text-text-3">Unattributed</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

// ─── Issue Tracking report (Recurring test cases + Reopened Jira) ─────

interface RecurringCaseCycle {
  id: string;
  name: string;
  result: RunResult;
  ts: string;
}
interface RecurringCaseRow {
  id: string;
  caseNum: number;
  title: string;
  severity: Severity;
  moduleName: string;
  scopePath: string;
  ownerName: string | null;
  cycles: RecurringCaseCycle[];
}
interface JiraIssueCycleRef {
  id: string;
  name: string;
  ts: string;
}
interface JiraIssueRow {
  issueKey: string;
  title: string;
  severity: Severity;
  status: string;
  siteUrl: string | null;
  cycles: JiraIssueCycleRef[];
  cycleCount: number;
  reopenedCount: number;
  lastSeen: string;
}
interface RecurringIssuesPayload {
  cases: RecurringCaseRow[];
  jiraReopened: JiraIssueRow[];
}

type RecurringTopTab = 'recurring' | 'reopened';

function SourcePill({ source }: { source: 'case' | 'jira' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        source === 'jira' ? 'bg-blue-100 text-blue-800' : 'bg-surface-3 text-text-2',
      )}
    >
      {source === 'jira' ? 'Jira' : 'Test Case'}
    </span>
  );
}

function ReopenedBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800">
      Reopened {count}×
    </span>
  );
}

function JiraIssueRowView({
  issue,
  siteUrl,
  occurrenceLabel,
  onOpenCycle,
}: {
  issue: JiraIssueRow;
  siteUrl: string | null;
  occurrenceLabel: string;
  onOpenCycle?: (cycleId: string) => void;
}) {
  const resolvedSiteUrl = issue.siteUrl ?? siteUrl;
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <SourcePill source="jira" />
            <span className="inline-flex items-center gap-1">
              <JiraTicketLink
                ticketLink={issue.issueKey}
                siteUrl={resolvedSiteUrl}
                className="font-mono text-[10.5px] text-text-3"
              />
              {resolvedSiteUrl && <i className="ti ti-external-link text-[10px] text-text-3" />}
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                severityBadge(issue.severity),
              )}
            >
              {issue.severity}
            </span>
            {issue.reopenedCount > 0 && <ReopenedBadge count={issue.reopenedCount} />}
          </div>
          <p className="mt-0.5 text-[13px] font-medium text-text">{issue.title}</p>
          <p className="text-[11.5px] text-text-3">
            {issue.status} · last synced {relativeTime(issue.lastSeen)}
          </p>
        </div>
        <span className="flex-shrink-0 text-[11px] font-medium text-danger">{occurrenceLabel}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10.5px] uppercase tracking-wide text-text-3">Synced in</span>
        {issue.cycles.map(cy => (
          <button
            key={cy.id}
            type="button"
            disabled={!onOpenCycle}
            onClick={() => onOpenCycle?.(cy.id)}
            title={relativeTime(cy.ts)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text-2 transition-colors',
              onOpenCycle && 'cursor-pointer hover:border-primary hover:text-primary-text',
            )}
          >
            {cy.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function RecurringIssuesReport({
  projectId,
  filters,
  onCsvReady,
}: {
  projectId: string | null;
  filters: Filters;
  onCsvReady: (fn: () => void) => void;
}) {
  const [data, setData] = useState<RecurringIssuesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [topTab, setTopTab] = useState<RecurringTopTab>('recurring');
  const [viewingCycleId, setViewingCycleId] = useState<string | null>(null);
  const workspaceSiteUrl = useJiraSiteUrl(projectId);

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (filters.portalId) params.set('portalId', filters.portalId);
    if (filters.moduleId) params.set('moduleId', filters.moduleId);
    if (filters.suiteId) params.set('suiteId', filters.suiteId);
    if (filters.version) params.set('version', filters.version);
    if (filters.tester) params.set('tester', filters.tester);
    params.set('period', filters.period);
    if (filters.period === 'sprint') params.set('sprintOffset', String(filters.sprintOffset));
    setLoading(true);
    api
      .get<RecurringIssuesPayload>(`/api/reports/recurring-issues?${params.toString()}`)
      .then(setData)
      .catch(e => console.error('[recurring issues report]', e))
      .finally(() => setLoading(false));
  }, [
    projectId,
    filters.portalId,
    filters.moduleId,
    filters.suiteId,
    filters.version,
    filters.tester,
    filters.period,
    filters.sprintOffset,
  ]);

  // Recurring is test-case-only; Jira only feeds the separate Reopened
  // signal (see the route) — the two never mix into one list.
  const recurringCases = data?.cases ?? [];
  const reopenedJira = data?.jiraReopened ?? [];

  const recurringCount = data?.cases.length ?? 0;
  const reopenedCount = data?.jiraReopened.length ?? 0;
  const visibleCount = topTab === 'recurring' ? recurringCases.length : reopenedJira.length;

  const onCsv = () => {
    if (!data) return;
    if (topTab === 'reopened') {
      const rows: (string | number)[][] = [['Issue', 'Title', 'Status', 'Reopened', 'Last synced']];
      for (const j of data.jiraReopened) {
        rows.push([j.issueKey, j.title, j.status, j.reopenedCount, relativeTime(j.lastSeen)]);
      }
      downloadCsv('reopened-issues.csv', rows);
      return;
    }
    const rows: (string | number)[][] = [
      ['Case', 'Module → Suite', 'Severity', 'Owner', 'Recurred in'],
    ];
    for (const c of recurringCases) {
      rows.push([
        `TC-${String(c.caseNum).padStart(4, '0')} ${c.title}`,
        c.scopePath,
        c.severity,
        c.ownerName ?? 'Unassigned',
        c.cycles.map(cy => cy.name).join('; '),
      ]);
    }
    downloadCsv('recurring-issues.csv', rows);
  };

  useEffect(() => {
    onCsvReady(onCsv);
  });

  return (
    <div>
      <div className="mt-2 flex items-center gap-4 border-b border-border">
        {[
          { key: 'recurring' as const, label: 'Recurring', count: recurringCount },
          { key: 'reopened' as const, label: 'Reopened', count: reopenedCount },
        ].map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTopTab(t.key)}
            className={cn(
              'relative inline-flex items-center gap-1.5 px-1 pb-2.5 text-[13.5px] font-medium transition-colors',
              topTab === t.key ? 'text-text' : 'text-text-3 hover:text-text-2',
            )}
          >
            {t.label}
            <span
              className={cn(
                'rounded-full px-1.5 py-px text-[10.5px]',
                topTab === t.key
                  ? 'bg-primary-light text-primary-text'
                  : 'bg-surface-2 text-text-3',
              )}
            >
              {t.count}
            </span>
            {topTab === t.key && (
              <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="mt-2 rounded-lg border border-border bg-surface p-8 text-center text-text-3">
          Loading…
        </div>
      ) : visibleCount === 0 ? (
        <div className="mt-2 rounded-lg border border-dashed border-border bg-surface p-8 text-center text-text-3">
          {topTab === 'recurring'
            ? 'No test case keeps failing across separate cycles right now.'
            : 'No synced Jira ticket is currently reopened.'}
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <p className="text-[11.5px] text-text-3">
              {visibleCount} {topTab === 'recurring' ? 'issue' : 'ticket'}
              {visibleCount === 1 ? '' : 's'} · worst offenders first
            </p>
          </div>
          <div className="divide-y divide-border">
            {topTab === 'recurring' &&
              recurringCases.map(c => (
                <div key={`case-${c.id}`} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10.5px] text-text-3">
                          TC-{String(c.caseNum).padStart(4, '0')}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                            severityBadge(c.severity),
                          )}
                        >
                          {c.severity}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[13px] font-medium text-text">{c.title}</p>
                      <p className="text-[11.5px] text-text-3">
                        {c.scopePath}
                        {c.ownerName && ` · ${c.ownerName}`}
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-[11px] font-medium text-danger">
                      Failed in {c.cycles.length} cycles
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10.5px] uppercase tracking-wide text-text-3">
                      Recurred in
                    </span>
                    {c.cycles.map(cy => (
                      <button
                        key={cy.id}
                        type="button"
                        onClick={() => setViewingCycleId(cy.id)}
                        title={`${cy.result} · ${relativeTime(cy.ts)}`}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text-2 transition-colors hover:border-primary hover:text-primary-text"
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                            cy.result === 'Failed' ? 'bg-danger' : 'bg-warning',
                          )}
                        />
                        {cy.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

            {topTab === 'reopened' &&
              reopenedJira.map(j => (
                <JiraIssueRowView
                  key={`jira-${j.issueKey}`}
                  issue={j}
                  siteUrl={workspaceSiteUrl}
                  occurrenceLabel={`Synced in ${j.cycleCount} ${j.cycleCount === 1 ? 'cycle' : 'cycles'}`}
                  onOpenCycle={setViewingCycleId}
                />
              ))}
          </div>
        </div>
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

function Th({ children, align }: { children: React.ReactNode; align?: 'right' | 'left' }) {
  return (
    <th
      className={cn(
        'border-b border-border px-3 py-2 text-[10px] font-medium uppercase tracking-[0.05em] text-text-3',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

// ─── Overview panel: coverage-by-module bars + pass/fail donut ─────────────

function ModuleCoverageRow({
  row,
}: {
  row: {
    name: string;
    portalName: string;
    total: number;
    passed: number;
    passRate: number;
    label: StabilityNode['label'];
  };
}) {
  const barColor =
    row.label === 'Stable'
      ? 'bg-emerald-500'
      : row.label === 'At Risk'
        ? 'bg-amber-500'
        : 'bg-red-500';
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="min-w-0 truncate font-medium text-text">
          {row.name} <span className="font-normal text-text-3">· {row.portalName}</span>
        </span>
        <span className="flex-shrink-0 font-mono text-[11.5px] text-text-3">
          <b className="font-semibold text-text">{row.passRate}%</b> · {row.passed}/{row.total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn('h-full rounded-full', barColor)}
          style={{ width: `${Math.max(row.passRate, 2)}%` }}
        />
      </div>
    </div>
  );
}

function PassFailDonut({ passed, failed }: { passed: number; failed: number }) {
  const total = passed + failed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const circumference = 2 * Math.PI * 15;
  const passLen = total > 0 ? (passed / total) * circumference : 0;
  const failLen = total > 0 ? (failed / total) * circumference : 0;
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 36 36" className="h-[130px] w-[130px] flex-shrink-0">
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="5"
          style={{ stroke: 'rgb(var(--surface-3))' }}
        />
        {total > 0 && (
          <>
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              stroke="#16A34A"
              strokeDasharray={`${passLen} ${circumference}`}
              transform="rotate(-90 18 18)"
            />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              strokeWidth="5"
              stroke="#DC2626"
              strokeDasharray={`${failLen} ${circumference}`}
              strokeDashoffset={-passLen}
              transform="rotate(-90 18 18)"
            />
          </>
        )}
        <text
          x="18"
          y="17.5"
          textAnchor="middle"
          fontSize="7"
          fontWeight="700"
          style={{ fill: 'rgb(var(--text))' }}
        >
          {passRate}%
        </text>
        <text
          x="18"
          y="23.5"
          textAnchor="middle"
          fontSize="2.6"
          letterSpacing="0.05"
          style={{ fill: 'rgb(var(--text-3))' }}
        >
          PASS RATE
        </text>
      </svg>
      <div className="flex flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="h-[9px] w-[9px] flex-shrink-0 rounded-[2px] bg-emerald-500" />
          <span className="flex-1 text-text-2">Passed</span>
          <span className="font-mono font-semibold tabular-nums">{passed}</span>
        </div>
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="h-[9px] w-[9px] flex-shrink-0 rounded-[2px] bg-red-500" />
          <span className="flex-1 text-text-2">Failed / blocked</span>
          <span className="font-mono font-semibold tabular-nums">{failed}</span>
        </div>
      </div>
    </div>
  );
}

// ─── small helpers ───────────────────────────────────────────

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map(r =>
      r
        .map(cell => {
          const s = String(cell ?? '');
          if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(','),
    )
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
