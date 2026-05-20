'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { avatarColour, cn, initials } from '@/lib/utils';
import { Portal } from '@/types';

interface ReportsProps {
  projectId: string | null;
  projectName: string;
  portals: Portal[];
}

type ReportType = 'execution' | 'release' | 'tester' | 'coverage';

interface ReportTypeMeta {
  id: ReportType;
  label: string;
  sub: string;
  icon: string;
  iconColor: string; // tailwind classes
}

const REPORT_TYPES: ReportTypeMeta[] = [
  {
    id: 'execution',
    label: 'Execution',
    sub: 'Test run results',
    icon: 'ti-player-play',
    iconColor: 'bg-indigo-100 text-indigo-700',
  },
  {
    id: 'release',
    label: 'Release',
    sub: 'Sprint summary',
    icon: 'ti-rocket',
    iconColor: 'bg-emerald-100 text-emerald-700',
  },
  {
    id: 'tester',
    label: 'Tester perf',
    sub: 'Performance',
    icon: 'ti-users',
    iconColor: 'bg-pink-100 text-pink-700',
  },
  {
    id: 'coverage',
    label: 'Coverage',
    sub: 'Module coverage',
    icon: 'ti-chart-pie',
    iconColor: 'bg-amber-100 text-amber-700',
  },
];

interface Filters {
  days: '7' | '30' | '90' | '365' | 'all';
  portalId: string; // '' = all
  cycleId: string;
  tester: string;
}

const DEFAULT_FILTERS: Filters = { days: '30', portalId: '', cycleId: '', tester: '' };

export function Reports({ projectId, projectName, portals }: ReportsProps) {
  const [reportType, setReportType] = useState<ReportType>('execution');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  // Track which filters apply per report so the UI hides irrelevant ones.
  const visibleFilters = useMemo(() => {
    switch (reportType) {
      case 'execution':
        return { days: true, portal: true, cycle: true, tester: true };
      case 'release':
        return { days: true, portal: false, cycle: false, tester: false };
      case 'tester':
        return { days: true, portal: false, cycle: false, tester: false };
      case 'coverage':
        return { days: false, portal: true, cycle: false, tester: false };
    }
  }, [reportType]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">
              Reports
            </h1>
            <p className="text-[13px] text-text-2">Generate, schedule, and share QA reports.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled
              title="Coming soon"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-[7px] text-[13px] text-text-3"
            >
              <i className="ti ti-history text-[15px]" />
              History
            </button>
            <button
              type="button"
              disabled
              title="Coming soon"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-[7px] text-[13px] text-text-3"
            >
              <i className="ti ti-clock text-[15px]" />
              Schedule
            </button>
          </div>
        </div>

        {/* Report type cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {REPORT_TYPES.map(rt => (
            <ReportTypeCard
              key={rt.id}
              meta={rt}
              active={rt.id === reportType}
              onClick={() => setReportType(rt.id)}
            />
          ))}
        </div>

        {/* Filters + Report body */}
        <div className="flex items-start gap-5">
          {/* Filters card */}
          <aside className="w-[240px] flex-shrink-0 rounded-lg border border-border bg-surface p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-text-3">
              Filters
            </div>

            {visibleFilters.days && (
              <FilterField label="Date range">
                <select
                  value={filters.days}
                  onChange={e =>
                    setFilters(f => ({ ...f, days: e.target.value as Filters['days'] }))
                  }
                  className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                >
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="365">Last 12 months</option>
                  <option value="all">All time</option>
                </select>
              </FilterField>
            )}

            {visibleFilters.portal && (
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
            )}

            {visibleFilters.cycle && (
              <CycleFilter
                projectId={projectId}
                value={filters.cycleId}
                onChange={v => setFilters(f => ({ ...f, cycleId: v }))}
              />
            )}

            {visibleFilters.tester && (
              <TesterFilter
                projectId={projectId}
                value={filters.tester}
                onChange={v => setFilters(f => ({ ...f, tester: v }))}
              />
            )}

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
            {reportType === 'execution' && (
              <ExecutionReport
                projectId={projectId}
                projectName={projectName}
                portals={portals}
                filters={filters}
              />
            )}
            {reportType === 'release' && (
              <ReleaseReport projectId={projectId} projectName={projectName} filters={filters} />
            )}
            {reportType === 'tester' && (
              <TesterReport projectId={projectId} projectName={projectName} filters={filters} />
            )}
            {reportType === 'coverage' && (
              <CoverageReport
                projectId={projectId}
                projectName={projectName}
                portals={portals}
                filters={filters}
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

function CycleFilter({
  projectId,
  value,
  onChange,
}: {
  projectId: string | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const [cycles, setCycles] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!projectId) return;
    api
      .get<{ id: string; name: string }[]>(`/api/cycles?projectId=${projectId}`)
      .then(setCycles)
      .catch(e => console.error('[cycle filter]', e));
  }, [projectId]);
  return (
    <FilterField label="Test plan">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
      >
        <option value="">All plans</option>
        {cycles.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

function TesterFilter({
  projectId,
  value,
  onChange,
}: {
  projectId: string | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const [testers, setTesters] = useState<string[]>([]);
  useEffect(() => {
    // Reuse the execution endpoint to grab the distinct executor list — cheap and consistent.
    const params = new URLSearchParams({ days: 'all' });
    if (projectId) params.set('projectId', projectId);
    api
      .get<{ filters: { testers: string[] } }>(`/api/reports/execution?${params.toString()}`)
      .then(r => setTesters(r.filters.testers))
      .catch(e => console.error('[tester filter]', e));
  }, [projectId]);
  return (
    <FilterField label="Tester">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
      >
        <option value="">All testers</option>
        {testers.map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

// ─── Report type card ───────────────────────────────────────

function ReportTypeCard({
  meta,
  active,
  onClick,
}: {
  meta: ReportTypeMeta;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-start gap-3 rounded-lg border bg-surface p-3 text-left transition-all',
        active
          ? 'border-primary shadow-sm ring-2 ring-primary-light'
          : 'border-border hover:border-border-strong hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md',
          meta.iconColor,
        )}
      >
        <i className={cn('ti', meta.icon, 'text-[18px]')} />
      </span>
      <div className="min-w-0">
        <div
          className={cn('text-[13px] font-semibold', active ? 'text-primary-text' : 'text-text')}
        >
          {meta.label}
        </div>
        <div className="text-[11px] text-text-3">{meta.sub}</div>
      </div>
    </button>
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

// ─── Execution report ────────────────────────────────────────

interface ExecutionPayload {
  kpis: {
    executed: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    passRate: number;
  };
  daily: { label: string; pass: number; fail: number; blocked: number; total: number }[];
}

function ExecutionReport({
  projectId,
  projectName,
  portals,
  filters,
}: {
  projectId: string | null;
  projectName: string;
  portals: Portal[];
  filters: Filters;
}) {
  const [data, setData] = useState<ExecutionPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const portalName = filters.portalId
    ? (portals.find(p => p.id === filters.portalId)?.name ?? 'Selected portal')
    : 'All portals';

  useEffect(() => {
    const params = new URLSearchParams({ days: filters.days });
    if (projectId) params.set('projectId', projectId);
    if (filters.portalId) params.set('portalId', filters.portalId);
    if (filters.cycleId) params.set('cycleId', filters.cycleId);
    if (filters.tester) params.set('tester', filters.tester);
    setLoading(true);
    api
      .get<ExecutionPayload>(`/api/reports/execution?${params.toString()}`)
      .then(setData)
      .catch(e => console.error('[execution report]', e))
      .finally(() => setLoading(false));
  }, [projectId, filters]);

  const onCsv = useCallback(() => {
    if (!data) return;
    const rows = [
      ['Bucket', 'Pass', 'Fail', 'Blocked', 'Total'],
      ...data.daily.map(d => [d.label, d.pass, d.fail, d.blocked, d.total]),
    ];
    downloadCsv(`execution-${projectName.toLowerCase().replace(/\s+/g, '-')}.csv`, rows);
  }, [data, projectName]);

  return (
    <div>
      <ReportHeader
        title="Execution report"
        subtitle={`${portalName} · ${windowLabel(filters.days)}`}
        onCsv={onCsv}
        onPdf={() => window.print()}
        onShare={() => navigator.clipboard?.writeText(window.location.href)}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Executed" value={data?.kpis.executed ?? 0} tone="neutral" />
        <KpiCard label="Passed" value={data?.kpis.passed ?? 0} tone="success" />
        <KpiCard label="Failed" value={data?.kpis.failed ?? 0} tone="danger" />
        <KpiCard
          label="Pass rate"
          value={`${data?.kpis.passRate ?? 0}%`}
          tone={(data?.kpis.passRate ?? 0) >= 80 ? 'success' : 'warning'}
        />
      </div>

      <div className="mt-4 rounded-lg border border-border bg-surface p-4">
        <p className="mb-2 text-[12.5px] font-semibold text-text">Daily executions</p>
        {loading && !data ? (
          <SkeletonChart />
        ) : (
          <BarChart
            data={data?.daily ?? []}
            valueOf={d => d.total}
            labelOf={d => d.label}
            colorOf={() => 'bg-indigo-500'}
          />
        )}
      </div>
    </div>
  );
}

// ─── Release report ─────────────────────────────────────────

interface ReleasePayload {
  releases: {
    id: string;
    name: string;
    status: string;
    total: number;
    done: number;
    passRate: number;
    percent: number;
    counts: { Passed: number; Failed: number; Blocked: number; Skipped: number; NotRun: number };
    testers: string[];
    createdAt: string;
    targetDate: string | null;
  }[];
  totals: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    overallPassRate: number;
    cycles: number;
  };
}

function ReleaseReport({
  projectId,
  projectName,
  filters,
}: {
  projectId: string | null;
  projectName: string;
  filters: Filters;
}) {
  const [data, setData] = useState<ReleasePayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ days: filters.days });
    if (projectId) params.set('projectId', projectId);
    setLoading(true);
    api
      .get<ReleasePayload>(`/api/reports/release?${params.toString()}`)
      .then(setData)
      .catch(e => console.error('[release report]', e))
      .finally(() => setLoading(false));
  }, [projectId, filters.days]);

  const onCsv = () => {
    if (!data) return;
    const rows = [
      ['Cycle', 'Status', 'Total', 'Done', 'Passed', 'Failed', 'Blocked', 'Pass rate', 'Created'],
      ...data.releases.map(r => [
        r.name,
        r.status,
        r.total,
        r.done,
        r.counts.Passed,
        r.counts.Failed,
        r.counts.Blocked,
        `${r.passRate}%`,
        new Date(r.createdAt).toLocaleDateString(),
      ]),
    ];
    downloadCsv(`release-${projectName.toLowerCase().replace(/\s+/g, '-')}.csv`, rows);
  };

  return (
    <div>
      <ReportHeader
        title="Release report"
        subtitle={`${data?.totals.cycles ?? 0} cycles · ${windowLabel(filters.days)}`}
        onCsv={onCsv}
        onPdf={() => window.print()}
        onShare={() => navigator.clipboard?.writeText(window.location.href)}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Cycles" value={data?.totals.cycles ?? 0} tone="neutral" />
        <KpiCard label="Total runs" value={data?.totals.total ?? 0} tone="neutral" />
        <KpiCard label="Failures" value={data?.totals.failed ?? 0} tone="danger" />
        <KpiCard
          label="Avg pass rate"
          value={`${data?.totals.overallPassRate ?? 0}%`}
          tone={(data?.totals.overallPassRate ?? 0) >= 80 ? 'success' : 'warning'}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-2">
            <tr>
              <Th>Cycle</Th>
              <Th width="80px">Status</Th>
              <Th width="60px">Total</Th>
              <Th width="60px">Done</Th>
              <Th width="120px">Result split</Th>
              <Th width="80px">Pass</Th>
              <Th width="120px">Testers</Th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-3">
                  Loading…
                </td>
              </tr>
            ) : (data?.releases.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-3">
                  No cycles in this window.
                </td>
              </tr>
            ) : (
              data!.releases.map(r => (
                <tr
                  key={r.id}
                  className="border-b border-border last:border-b-0 hover:bg-surface-2"
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-text">{r.name}</div>
                    <div className="text-[10.5px] text-text-3">
                      Created {new Date(r.createdAt).toLocaleDateString()}
                      {r.targetDate && ` · due ${new Date(r.targetDate).toLocaleDateString()}`}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={r.status as 'Active' | 'Completed' | 'Archived'} />
                  </td>
                  <td className="px-3 py-2.5 text-text-2">{r.total}</td>
                  <td className="px-3 py-2.5 text-text-2">
                    {r.done} <span className="text-text-3">({r.percent}%)</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <MiniSplitBar counts={r.counts} total={r.total} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        'font-semibold',
                        r.passRate >= 80
                          ? 'text-emerald-600'
                          : r.passRate >= 50
                            ? 'text-amber-600'
                            : 'text-red-600',
                      )}
                    >
                      {r.passRate}%
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <AvatarStack names={r.testers} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tester perf report ─────────────────────────────────────

interface TesterPayload {
  testers: {
    name: string;
    executed: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    passRate: number;
    avgPerDay: number;
  }[];
  totals: { testers: number; executed: number; avgPassRate: number };
}

function TesterReport({
  projectId,
  projectName,
  filters,
}: {
  projectId: string | null;
  projectName: string;
  filters: Filters;
}) {
  const [data, setData] = useState<TesterPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ days: filters.days });
    if (projectId) params.set('projectId', projectId);
    setLoading(true);
    api
      .get<TesterPayload>(`/api/reports/tester-perf?${params.toString()}`)
      .then(setData)
      .catch(e => console.error('[tester report]', e))
      .finally(() => setLoading(false));
  }, [projectId, filters.days]);

  const onCsv = () => {
    if (!data) return;
    const rows = [
      ['Tester', 'Executed', 'Passed', 'Failed', 'Blocked', 'Pass rate', 'Avg/day'],
      ...data.testers.map(t => [
        t.name,
        t.executed,
        t.passed,
        t.failed,
        t.blocked,
        `${t.passRate}%`,
        t.avgPerDay,
      ]),
    ];
    downloadCsv(`tester-perf-${projectName.toLowerCase().replace(/\s+/g, '-')}.csv`, rows);
  };

  return (
    <div>
      <ReportHeader
        title="Tester performance"
        subtitle={`${data?.totals.testers ?? 0} testers · ${windowLabel(filters.days)}`}
        onCsv={onCsv}
        onPdf={() => window.print()}
        onShare={() => navigator.clipboard?.writeText(window.location.href)}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiCard label="Active testers" value={data?.totals.testers ?? 0} tone="neutral" />
        <KpiCard label="Total executed" value={data?.totals.executed ?? 0} tone="neutral" />
        <KpiCard
          label="Avg pass rate"
          value={`${data?.totals.avgPassRate ?? 0}%`}
          tone={(data?.totals.avgPassRate ?? 0) >= 80 ? 'success' : 'warning'}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-2">
            <tr>
              <Th>Tester</Th>
              <Th width="80px">Executed</Th>
              <Th width="80px">Pass</Th>
              <Th width="80px">Fail</Th>
              <Th width="80px">Block</Th>
              <Th width="160px">Pass rate</Th>
              <Th width="80px">Avg/day</Th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-3">
                  Loading…
                </td>
              </tr>
            ) : (data?.testers.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-3">
                  No executions recorded in this window.
                </td>
              </tr>
            ) : (
              data!.testers.map(t => (
                <tr
                  key={t.name}
                  className="border-b border-border last:border-b-0 hover:bg-surface-2"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold',
                          avatarColour(t.name),
                        )}
                      >
                        {initials(t.name)}
                      </span>
                      <span className="font-medium text-text">{t.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-text-2">{t.executed}</td>
                  <td className="px-3 py-2.5 text-emerald-700">{t.passed}</td>
                  <td className="px-3 py-2.5 text-red-700">{t.failed}</td>
                  <td className="px-3 py-2.5 text-amber-700">{t.blocked}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className={cn(
                            'h-full transition-all',
                            t.passRate >= 80
                              ? 'bg-emerald-500'
                              : t.passRate >= 50
                                ? 'bg-amber-500'
                                : 'bg-red-500',
                          )}
                          style={{ width: `${t.passRate}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          'w-10 text-right font-semibold',
                          t.passRate >= 80
                            ? 'text-emerald-700'
                            : t.passRate >= 50
                              ? 'text-amber-700'
                              : 'text-red-700',
                        )}
                      >
                        {t.passRate}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-text-2">{t.avgPerDay}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Coverage report ────────────────────────────────────────

interface CoveragePayload {
  portals: {
    id: string;
    name: string;
    icon: string | null;
    totalCases: number;
    covered: number;
    coverage: number;
    modules: { id: string; name: string; totalCases: number; covered: number; coverage: number }[];
  }[];
  totals: { totalCases: number; covered: number; overall: number; portals: number };
}

function CoverageReport({
  projectId,
  projectName,
  portals,
  filters,
}: {
  projectId: string | null;
  projectName: string;
  portals: Portal[];
  filters: Filters;
}) {
  const [data, setData] = useState<CoveragePayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    setLoading(true);
    api
      .get<CoveragePayload>(`/api/reports/coverage?${params.toString()}`)
      .then(setData)
      .catch(e => console.error('[coverage report]', e))
      .finally(() => setLoading(false));
  }, [projectId]);

  const portalsToShow = useMemo(() => {
    if (!data) return [];
    if (filters.portalId) return data.portals.filter(p => p.id === filters.portalId);
    return data.portals;
  }, [data, filters.portalId]);

  const onCsv = () => {
    if (!data) return;
    const rows: (string | number)[][] = [['Portal', 'Module', 'Total', 'Covered', 'Coverage']];
    for (const p of portalsToShow) {
      for (const m of p.modules) {
        rows.push([p.name, m.name, m.totalCases, m.covered, `${m.coverage}%`]);
      }
    }
    downloadCsv(`coverage-${projectName.toLowerCase().replace(/\s+/g, '-')}.csv`, rows);
  };

  const portalName = filters.portalId
    ? (portals.find(p => p.id === filters.portalId)?.name ?? 'Selected portal')
    : 'All portals';

  return (
    <div>
      <ReportHeader
        title="Coverage report"
        subtitle={`${portalName} · all-time test cases`}
        onCsv={onCsv}
        onPdf={() => window.print()}
        onShare={() => navigator.clipboard?.writeText(window.location.href)}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiCard label="Total cases" value={data?.totals.totalCases ?? 0} tone="neutral" />
        <KpiCard label="With coverage" value={data?.totals.covered ?? 0} tone="success" />
        <KpiCard
          label="Overall coverage"
          value={`${data?.totals.overall ?? 0}%`}
          tone={(data?.totals.overall ?? 0) >= 80 ? 'success' : 'warning'}
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
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <i
                    className={cn(
                      'ti',
                      p.icon && p.icon.startsWith('ti-') ? p.icon : 'ti-app-window',
                      'text-[16px] text-text-3',
                    )}
                  />
                  <span className="text-[13px] font-semibold text-text">{p.name}</span>
                  <span className="text-[11px] text-text-3">
                    {p.covered}/{p.totalCases} covered
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn(
                        'h-full',
                        p.coverage >= 80
                          ? 'bg-emerald-500'
                          : p.coverage >= 50
                            ? 'bg-amber-500'
                            : 'bg-red-500',
                      )}
                      style={{ width: `${p.coverage}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      'text-[12.5px] font-semibold',
                      p.coverage >= 80
                        ? 'text-emerald-700'
                        : p.coverage >= 50
                          ? 'text-amber-700'
                          : 'text-red-700',
                    )}
                  >
                    {p.coverage}%
                  </span>
                </div>
              </div>
              <div className="divide-y divide-border">
                {p.modules.length === 0 && (
                  <p className="px-4 py-3 text-[12px] italic text-text-3">No modules</p>
                )}
                {p.modules.map(m => (
                  <div key={m.id} className="flex items-center justify-between px-4 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <i className="ti ti-folder text-[13px] text-text-3" />
                      <span className="truncate text-[12.5px] text-text">{m.name}</span>
                      <span className="text-[11px] text-text-3">
                        ({m.covered}/{m.totalCases})
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1 w-24 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className={cn(
                            'h-full',
                            m.coverage >= 80
                              ? 'bg-emerald-500'
                              : m.coverage >= 50
                                ? 'bg-amber-500'
                                : 'bg-red-500',
                          )}
                          style={{ width: `${m.coverage}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-[12px] text-text-2">{m.coverage}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
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

function Th({ children, width }: { children: React.ReactNode; width?: string }) {
  return (
    <th
      style={width ? { width } : undefined}
      className="border-b border-border px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-text-3"
    >
      {children}
    </th>
  );
}

function StatusBadge({ status }: { status: 'Active' | 'Completed' | 'Archived' }) {
  const cls =
    status === 'Active'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : status === 'Completed'
        ? 'bg-blue-50 text-blue-700 ring-blue-200'
        : 'bg-amber-50 text-amber-700 ring-amber-200';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1',
        cls,
      )}
    >
      {status}
    </span>
  );
}

function MiniSplitBar({
  counts,
  total,
}: {
  counts: { Passed: number; Failed: number; Blocked: number; Skipped: number; NotRun: number };
  total: number;
}) {
  if (total === 0) return <span className="text-[11px] text-text-3">—</span>;
  const pct = (n: number) => (n / total) * 100;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      {counts.Passed > 0 && (
        <div className="h-full bg-emerald-500" style={{ width: `${pct(counts.Passed)}%` }} />
      )}
      {counts.Failed > 0 && (
        <div className="h-full bg-red-500" style={{ width: `${pct(counts.Failed)}%` }} />
      )}
      {counts.Blocked > 0 && (
        <div className="h-full bg-amber-500" style={{ width: `${pct(counts.Blocked)}%` }} />
      )}
      {counts.Skipped > 0 && (
        <div className="h-full bg-slate-400" style={{ width: `${pct(counts.Skipped)}%` }} />
      )}
    </div>
  );
}

function AvatarStack({ names }: { names: string[] }) {
  if (names.length === 0) return <span className="text-[11px] text-text-3">—</span>;
  return (
    <div className="flex -space-x-1.5">
      {names.slice(0, 3).map(n => (
        <span
          key={n}
          title={n}
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold ring-2 ring-surface',
            avatarColour(n),
          )}
        >
          {initials(n)}
        </span>
      ))}
      {names.length > 3 && (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-[9px] font-semibold text-text-2 ring-2 ring-surface">
          +{names.length - 3}
        </span>
      )}
    </div>
  );
}

// ─── Mini SVG-free bar chart (CSS heights) ──────────────────

function BarChart<T>({
  data,
  valueOf,
  labelOf,
  colorOf,
}: {
  data: T[];
  valueOf: (d: T) => number;
  labelOf: (d: T) => string;
  colorOf: (d: T) => string;
}) {
  const max = Math.max(1, ...data.map(valueOf));
  if (data.length === 0) {
    return <p className="py-6 text-center text-[12px] text-text-3">No data in this window.</p>;
  }
  return (
    <div className="flex h-[140px] items-end gap-1">
      {data.map((d, i) => {
        const v = valueOf(d);
        const h = max === 0 ? 0 : Math.max(2, (v / max) * 100);
        return (
          <div
            key={i}
            title={`${labelOf(d)} · ${v}`}
            className="flex flex-1 flex-col items-center justify-end"
          >
            <div className={cn('w-full rounded-t-sm', colorOf(d))} style={{ height: `${h}%` }} />
            <span className="mt-1 truncate text-[9px] text-text-3">{labelOf(d)}</span>
          </div>
        );
      })}
    </div>
  );
}

function SkeletonChart() {
  return <div className="h-[140px] animate-pulse rounded bg-surface-2" />;
}

// ─── small helpers ───────────────────────────────────────────

function windowLabel(days: Filters['days']): string {
  if (days === 'all') return 'all time';
  if (days === '365') return 'last 12 months';
  return `last ${days} days`;
}

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
