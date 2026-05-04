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
    return <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Loading dashboard…</div>;
  }
  if (error || !data) {
    return <div className="flex-1 flex items-center justify-center text-sm text-red-500">{error || 'Failed to load'}</div>;
  }

  const lastUpdated = 'just now';

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      {/* Header */}
      <div className="px-8 pt-6 pb-4 bg-white border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900">Quality Dashboard</h1>
        <p className="text-xs text-slate-400 mt-1">Last updated: {lastUpdated} · Live data</p>
      </div>

      <div className="px-8 py-6 flex flex-col gap-6">
        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
            sub={data.openFailures.newToday > 0 ? `↑ ${data.openFailures.newToday} new today` : 'No new today'}
            tone={data.openFailures.total > 0 ? 'negative' : 'positive'}
            valueColor="text-red-600"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Recent Test Runs" subtitle="Most recent cycles, with progress and pass rate">
            <Legend items={[
              { label: 'Pass', color: '#10b981' },
              { label: 'Fail', color: '#ef4444' },
              { label: 'Blocked', color: '#f59e0b' },
              { label: 'Skipped', color: '#94a3b8' },
            ]} />
            {data.recentCycles.length === 0 ? (
              <p className="text-sm text-slate-400 mt-4 text-center">No test runs yet. <button onClick={onShowTestRuns} className="text-blue-600 hover:underline">Create one</button>.</p>
            ) : (
              <div className="flex flex-col divide-y divide-slate-100 -mx-1">
                {data.recentCycles.map(c => (
                  <button
                    key={c.id}
                    onClick={() => onOpenCycle?.(c.id)}
                    className="flex flex-col gap-1.5 py-2.5 px-1 hover:bg-slate-50 rounded-md text-left cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-sm font-semibold text-slate-800 truncate">{c.name}</span>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">
                        {new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-px rounded ${
                        c.status === 'Active'    ? 'bg-blue-50 text-blue-700' :
                        c.status === 'Completed' ? 'bg-green-50 text-green-700' :
                                                   'bg-slate-100 text-slate-500'
                      }`}>
                        {c.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-400">Scope:</span>
                      <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-px rounded ${
                        c.scopeType === 'All'     ? 'bg-slate-100 text-slate-600' :
                        c.scopeType === 'Module'  ? 'bg-indigo-50 text-indigo-700' :
                        c.scopeType === 'Feature' ? 'bg-blue-50 text-blue-700' :
                                                    'bg-amber-50 text-amber-700'
                      }`}>{c.scopeType}</span>
                      <span className="truncate" title={c.scopeName ?? undefined}>{c.scopeName ?? '—'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <SegmentedProgressBar counts={c.counts} total={c.total} height={6} />
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono w-[64px] text-right whitespace-nowrap">
                        {c.done}/{c.total}
                      </span>
                      <span className="text-[11px] text-green-700 font-semibold font-mono w-[64px] text-right whitespace-nowrap">
                        {c.passRate}% pass
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ChartCard>
          <ChartCard title="Module & Feature Stability" subtitle="Pass rate per module — across all runs">
            {data.moduleStability.length === 0 ? (
              <p className="text-sm text-slate-400 mt-4">No data yet — execute some test runs to see stability.</p>
            ) : (
              <div className="flex flex-col gap-3 mt-2">
                {data.moduleStability.map(m => (
                  <StabilityRow key={m.name} name={m.name} passRate={m.passRate} totalRuns={m.totalRuns} />
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

function KpiCard({ label, value, sub, tone, valueColor }: { label: string; value: string; sub: string; tone: 'positive' | 'negative' | 'neutral'; valueColor?: string }) {
  const subColor = tone === 'positive' ? 'text-green-600' : tone === 'negative' ? 'text-red-600' : 'text-slate-400';
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-2">{label}</p>
      <p className={`text-3xl font-bold ${valueColor || 'text-slate-900'}`}>{value}</p>
      <p className={`text-[11px] mt-1 ${subColor}`}>{sub}</p>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <p className="text-[11px] text-slate-400 mb-3">{subtitle}</p>
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-4 mb-3">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function StabilityRow({ name, passRate, totalRuns }: { name: string; passRate: number | null; totalRuns: number }) {
  const color = passRate === null ? '#cbd5e1' : passRate >= 85 ? '#10b981' : passRate >= 70 ? '#f59e0b' : '#ef4444';
  const valueColor = passRate === null ? 'text-slate-400' : passRate >= 85 ? 'text-green-600' : passRate >= 70 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-700 w-[140px] truncate">{name}</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full transition-all" style={{ width: `${passRate ?? 0}%`, backgroundColor: color }} />
      </div>
      <span className={`text-xs font-semibold font-mono w-[40px] text-right ${valueColor}`}>
        {passRate === null ? '—' : `${passRate}%`}
      </span>
    </div>
  );
}
