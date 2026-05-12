'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { SegmentedProgressBar } from './CycleView';

interface RecentCycle {
  id: string;
  name: string;
  status: 'Active' | 'Completed' | 'Archived';
  scopeType: 'All' | 'Module' | 'Feature' | 'Custom';
  scopeName: string | null;
  createdAt: string;
  total: number;
  done: number;
  passRate: number;
  counts: { NotRun: number; Passed: number; Failed: number; Blocked: number; Skipped: number };
}

interface DashboardData {
  totalCases: number;
  runs30d: { total: number; prev: number };
  passRate: { current: number; prev: number; delta: number };
  openFailures: { total: number; newToday: number };
  weeklyRuns: { label: string; pass: number; fail: number; blocked: number; skipped: number }[];
  casesByModule: { name: string; count: number }[];
  moduleStability: { name: string; passRate: number | null; totalRuns: number }[];
  recentCycles: RecentCycle[];
}

interface DashboardProps {
  onShowTestRuns: () => void;
  onOpenCycle?: (id: string) => void;
}

export function Dashboard({ onShowTestRuns, onOpenCycle }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const d = await api.get<DashboardData>('/api/dashboard');
        setData(d);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        Loading dashboard…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-500">
        {error || 'Failed to load'}
      </div>
    );
  }

  const lastUpdated = 'just now';

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-8 pb-4 pt-6">
        <h1 className="text-2xl font-bold text-slate-900">Quality Dashboard</h1>
        <p className="mt-1 text-xs text-slate-400">Last updated: {lastUpdated} · Live data</p>
      </div>

      <div className="flex flex-col gap-6 px-8 py-6">
        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Total Test Cases"
            value={data.totalCases.toLocaleString()}
            sub={data.totalCases > 0 ? `${data.totalCases} total` : 'No cases yet'}
            tone="neutral"
          />
          <KpiCard
            label="Test Runs (30D)"
            value={data.runs30d.total.toLocaleString()}
            sub={
              data.runs30d.prev === 0
                ? 'no prev data'
                : `${data.runs30d.total >= data.runs30d.prev ? '↑' : '↓'} ${Math.abs(data.runs30d.total - data.runs30d.prev)} vs last 30d`
            }
            tone={data.runs30d.total >= data.runs30d.prev ? 'positive' : 'negative'}
          />
          <KpiCard
            label="Pass Rate"
            value={`${data.passRate.current}%`}
            sub={
              data.passRate.prev === 0
                ? 'no prev data'
                : `${data.passRate.delta >= 0 ? '↑' : '↓'} ${Math.abs(data.passRate.delta)}% vs prev`
            }
            tone={data.passRate.delta >= 0 ? 'positive' : 'negative'}
            valueColor="text-green-600"
          />
          <KpiCard
            label="Open Failures"
            value={data.openFailures.total.toLocaleString()}
            sub={
              data.openFailures.newToday > 0
                ? `↑ ${data.openFailures.newToday} new today`
                : 'No new today'
            }
            tone={data.openFailures.total > 0 ? 'negative' : 'positive'}
            valueColor="text-red-600"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title="Recent Test Runs"
            subtitle="Most recent cycles, with progress and pass rate"
          >
            <Legend
              items={[
                { label: 'Pass', color: '#10b981' },
                { label: 'Fail', color: '#ef4444' },
                { label: 'Blocked', color: '#f59e0b' },
                { label: 'Skipped', color: '#94a3b8' },
              ]}
            />
            {data.recentCycles.length === 0 ? (
              <p className="mt-4 text-center text-sm text-slate-400">
                No test runs yet.{' '}
                <button onClick={onShowTestRuns} className="text-blue-600 hover:underline">
                  Create one
                </button>
                .
              </p>
            ) : (
              <div className="-mx-1 flex flex-col divide-y divide-slate-100">
                {data.recentCycles.map(c => (
                  <button
                    key={c.id}
                    onClick={() => onOpenCycle?.(c.id)}
                    className="flex cursor-pointer flex-col gap-1.5 rounded-md px-1 py-2.5 text-left transition-colors hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm font-semibold text-slate-800">
                        {c.name}
                      </span>
                      <span className="whitespace-nowrap text-[10px] text-slate-400">
                        {new Date(c.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                      <span
                        className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${
                          c.status === 'Active'
                            ? 'bg-blue-50 text-blue-700'
                            : c.status === 'Completed'
                              ? 'bg-green-50 text-green-700'
                              : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                        Scope:
                      </span>
                      <span
                        className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${
                          c.scopeType === 'All'
                            ? 'bg-slate-100 text-slate-600'
                            : c.scopeType === 'Module'
                              ? 'bg-indigo-50 text-indigo-700'
                              : c.scopeType === 'Feature'
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {c.scopeType}
                      </span>
                      <span className="truncate" title={c.scopeName ?? undefined}>
                        {c.scopeName ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <SegmentedProgressBar counts={c.counts} total={c.total} height={6} />
                      </div>
                      <span className="w-[64px] whitespace-nowrap text-right font-mono text-[11px] text-slate-500">
                        {c.done}/{c.total}
                      </span>
                      <span className="w-[64px] whitespace-nowrap text-right font-mono text-[11px] font-semibold text-green-700">
                        {c.passRate}% pass
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ChartCard>
          <ChartCard
            title="Module & Feature Stability"
            subtitle="Pass rate per module — across all runs"
          >
            {data.moduleStability.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">
                No data yet — execute some test runs to see stability.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-3">
                {data.moduleStability.map(m => (
                  <StabilityRow
                    key={m.name}
                    name={m.name}
                    passRate={m.passRate}
                    totalRuns={m.totalRuns}
                  />
                ))}
              </div>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  tone,
  valueColor,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'positive' | 'negative' | 'neutral';
  valueColor?: string;
}) {
  const subColor =
    tone === 'positive'
      ? 'text-green-600'
      : tone === 'negative'
        ? 'text-red-600'
        : 'text-slate-400';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={`text-3xl font-bold ${valueColor || 'text-slate-900'}`}>{value}</p>
      <p className={`mt-1 text-[11px] ${subColor}`}>{sub}</p>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <p className="mb-3 text-[11px] text-slate-400">{subtitle}</p>
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-3 flex items-center gap-4">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function StabilityRow({
  name,
  passRate,
  totalRuns,
}: {
  name: string;
  passRate: number | null;
  totalRuns: number;
}) {
  const color =
    passRate === null
      ? '#cbd5e1'
      : passRate >= 85
        ? '#10b981'
        : passRate >= 70
          ? '#f59e0b'
          : '#ef4444';
  const valueColor =
    passRate === null
      ? 'text-slate-400'
      : passRate >= 85
        ? 'text-green-600'
        : passRate >= 70
          ? 'text-amber-600'
          : 'text-red-600';
  return (
    <div className="flex items-center gap-3">
      <span className="w-[140px] truncate text-xs text-slate-700">{name}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full transition-all"
          style={{ width: `${passRate ?? 0}%`, backgroundColor: color }}
        />
      </div>
      <span className={`w-[40px] text-right font-mono text-xs font-semibold ${valueColor}`}>
        {passRate === null ? '—' : `${passRate}%`}
      </span>
    </div>
  );
}
