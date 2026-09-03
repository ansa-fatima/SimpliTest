'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { avatarColour, cn, initials, relativeTime } from '@/lib/utils';
import { Portal } from '@/types';

interface ReportsProps {
  projectId: string | null;
  projectName: string;
  portals: Portal[];
  /** Opens a cycle's detail view — used by the Stability report's log drill-down. */
  onOpenCycle?: (cycleId: string) => void;
}

interface Filters {
  portalId: string; // '' = all
}

const DEFAULT_FILTERS: Filters = { portalId: '' };

// Report types available as tabs. Execution and Release were removed as
// report *content* (Stability — module/feature health blended from every
// quick log and test run — is the one that actually gets used day to day),
// but the tab structure stays: adding a report type back later is just
// another entry here plus a case in the switch below, not a page rebuild.
type ReportTab = 'stability';
const REPORT_TABS: { key: ReportTab; label: string }[] = [{ key: 'stability', label: 'Stability' }];

export function Reports({ projectId, projectName, portals, onOpenCycle }: ReportsProps) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [activeTab, setActiveTab] = useState<ReportTab>('stability');

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Header */}
        <div className="mb-4">
          <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">
            Reports
          </h1>
          <p className="text-[13px] text-text-2">
            Track how stable your product is, from quick logs and test runs.
          </p>
        </div>

        {/* Report type tabs */}
        <div className="mb-5 flex items-center gap-1.5">
          {REPORT_TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'rounded-[7px] px-2.5 py-1 text-[12.5px] transition-colors',
                activeTab === t.key
                  ? 'border border-primary bg-primary-light font-semibold text-primary-text'
                  : 'border border-border bg-surface text-text-2 hover:bg-surface-2',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Filters + Report body */}
        <div className="flex items-start gap-5">
          {/* Filters card */}
          <aside className="w-[240px] flex-shrink-0 rounded-lg border border-border bg-surface p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-text-3">
              Filters
            </div>

            <FilterField label="Portal">
              <select
                value={filters.portalId}
                onChange={e => setFilters(f => ({ ...f, portalId: e.target.value }))}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
              >
                <option value="">All portals</option>
                {portals.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FilterField>

            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="mt-2 w-full rounded border border-dashed border-border px-2 py-1 text-[11px] text-text-3 hover:bg-surface-2"
            >
              Reset filters
            </button>
          </aside>

          {/* Report content */}
          <section className="min-w-0 flex-1">
            {activeTab === 'stability' && (
              <StabilityReport
                projectId={projectId}
                projectName={projectName}
                portals={portals}
                filters={filters}
                onOpenCycle={onOpenCycle}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Filter sidebar bits ────────────────────────────────────

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-[11px] font-medium text-text-3">{label}</label>
      {children}
    </div>
  );
}

// ─── Report header (title strip + CSV/PDF/Share) ────────────

function ReportHeader({
  title,
  subtitle,
  onCsv,
  onPdf,
  onShare,
}: {
  title: string;
  subtitle: string;
  onCsv: () => void;
  onPdf: () => void;
  onShare: () => void;
}) {
  const [shared, setShared] = useState(false);
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[16px] font-semibold text-text">{title}</h2>
        <p className="mt-0.5 text-[12px] text-text-3">{subtitle}</p>
      </div>
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
          onClick={onPdf}
          className="inline-flex items-center gap-1 rounded-[7px] border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-2"
        >
          <i className="ti ti-file-text text-[14px]" />
          PDF
        </button>
        <button
          type="button"
          onClick={() => {
            onShare();
            setShared(true);
            setTimeout(() => setShared(false), 1800);
          }}
          className="inline-flex items-center gap-1 rounded-[7px] bg-primary px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-primary-hover"
        >
          <i className={cn('ti', shared ? 'ti-check' : 'ti-share', 'text-[14px]')} />
          {shared ? 'Copied!' : 'Share'}
        </button>
      </div>
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
}

function StabilityReport({
  projectId,
  projectName,
  portals,
  filters,
  onOpenCycle,
}: {
  projectId: string | null;
  projectName: string;
  portals: Portal[];
  filters: Filters;
  onOpenCycle?: (cycleId: string) => void;
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
    setLoading(true);
    api
      .get<StabilityPayload>(`/api/reports/stability?${params.toString()}`)
      .then(setData)
      .catch(e => console.error('[stability report]', e))
      .finally(() => setLoading(false));
  }, [projectId]);

  const portalsToShow = useMemo(() => {
    if (!data) return [];
    if (filters.portalId) return data.portals.filter(p => p.id === filters.portalId);
    return data.portals;
  }, [data, filters.portalId]);

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

  const portalName = filters.portalId
    ? (portals.find(p => p.id === filters.portalId)?.name ?? 'Selected portal')
    : 'All portals';

  return (
    <div>
      <ReportHeader
        title="Stability report"
        subtitle={`${portalName} · how stable each module & feature is, from quick logs and test runs`}
        onCsv={onCsv}
        onPdf={() => window.print()}
        onShare={() => navigator.clipboard?.writeText(window.location.href)}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Data points" value={data?.totals.totalDataPoints ?? 0} tone="neutral" />
        <KpiCard
          label="Overall pass rate"
          value={`${data?.totals.overallPassRate ?? 0}%`}
          tone={(data?.totals.overallPassRate ?? 0) >= 80 ? 'success' : 'warning'}
        />
        <KpiCard label="At risk modules" value={data?.totals.modules.atRisk ?? 0} tone="warning" />
        <KpiCard
          label="Unstable modules"
          value={data?.totals.modules.unstable ?? 0}
          tone="danger"
        />
      </div>

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
          onOpenCycle={onOpenCycle}
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
  onOpenCycle,
}: {
  breadcrumb: string;
  node: StabilityNode;
  onClose: () => void;
  onOpenCycle?: (cycleId: string) => void;
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
              <button
                key={g.cycleId}
                type="button"
                disabled={!onOpenCycle}
                onClick={() => {
                  onOpenCycle?.(g.cycleId);
                  onClose();
                }}
                className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
              >
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
                          ? 'bg-indigo-50 text-indigo-600'
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
                {onOpenCycle && (
                  <i className="ti ti-arrow-up-right flex-shrink-0 text-[13px] text-primary" />
                )}
              </button>
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

// ─── Reusable bits ───────────────────────────────────────────

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: 'neutral' | 'success' | 'danger' | 'warning';
}) {
  const cls =
    tone === 'success'
      ? 'text-emerald-700'
      : tone === 'danger'
        ? 'text-red-700'
        : tone === 'warning'
          ? 'text-amber-700'
          : 'text-text';
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">{label}</p>
      <p className={cn('mt-0.5 text-[22px] font-semibold leading-tight', cls)}>{value}</p>
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
