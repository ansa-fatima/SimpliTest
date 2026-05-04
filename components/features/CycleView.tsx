'use client';

import { useState } from 'react';
import { TestCycle, ApiTestRun, CycleSummary, RunResult } from '@/types';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { priorityBadge, severityBadge, typeBadge } from '@/lib/utils';
import { exportCycleResults } from '@/lib/export';
import { CycleReportModal } from './CycleReportModal';

interface CycleViewProps {
  cycle: TestCycle;
  runs: ApiTestRun[];
  summary: CycleSummary | null;
  loading: boolean;
  onBack: () => void;
  onSubmitResult: (runId: string, result: RunResult, notes?: string) => Promise<void>;
}

const RESULTS: RunResult[] = ['Passed', 'Failed', 'Blocked', 'Skipped'];

const RESULT_BADGE: Record<RunResult, string> = {
  NotRun:  'bg-slate-100 text-slate-500 border border-slate-200',
  Passed:  'bg-green-50 text-green-700 border border-green-200',
  Failed:  'bg-red-50 text-red-700 border border-red-200',
  Blocked: 'bg-amber-50 text-amber-700 border border-amber-200',
  Skipped: 'bg-slate-50 text-slate-500 border border-slate-200',
};

const RESULT_BTN: Record<RunResult, string> = {
  NotRun:  'border-slate-200 text-slate-500 hover:bg-slate-50',
  Passed:  'border-green-200 text-green-700 hover:bg-green-50',
  Failed:  'border-red-200 text-red-700 hover:bg-red-50',
  Blocked: 'border-amber-200 text-amber-700 hover:bg-amber-50',
  Skipped: 'border-slate-200 text-slate-500 hover:bg-slate-50',
};

export function CycleView({ cycle, runs, summary, loading, onBack, onSubmitResult }: CycleViewProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunResult | 'All'>('All');
  const [showReport, setShowReport] = useState(false);

  const filtered = filter === 'All' ? runs : runs.filter(r => r.result === filter);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Topbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-200">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
        >
          ← Back to Test Runs
        </button>
        <div className="flex-1 text-xs text-slate-400">
          Test Runs / <span className="font-semibold text-slate-800">{cycle.name}</span>
        </div>
        <Button variant="default" onClick={() => setShowReport(true)}>📋 Summary</Button>
        <Button variant="default" onClick={() => exportCycleResults(cycle, runs)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M3 10v3h10v-3M8 2v8M5 7l3 3 3-3"/></svg>
          Export .xlsx
        </Button>
      </div>

      {/* Progress widget (header bar) */}
      <ProgressWidget summary={summary} cycle={cycle} />

      {/* Result filter */}
      <div className="flex items-center gap-1.5 px-6 py-2.5 bg-slate-50 border-b border-slate-200">
        {(['All', 'NotRun', 'Passed', 'Failed', 'Blocked', 'Skipped'] as const).map(r => {
          const count = r === 'All'
            ? runs.length
            : (summary?.counts[r as RunResult] ?? 0);
          return (
            <button
              key={r}
              onClick={() => setFilter(r)}
              className={`px-3 py-1 rounded-full text-xs cursor-pointer transition-colors ${
                filter === r
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-100'
              }`}
            >
              {r === 'NotRun' ? 'Not run' : r} <span className="opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-sm text-slate-400">Loading runs…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
            <p className="text-sm font-semibold text-slate-500">
              {runs.length === 0 ? 'No runs in this cycle' : `No ${filter === 'NotRun' ? 'not run' : filter.toLowerCase()} runs`}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {['', 'Case ID', 'Title', 'Priority', 'Severity', 'Test Type', 'Status'].map((h, i) => (
                  <th
                    key={i}
                    className="sticky top-0 z-10 bg-slate-50 px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 border-b border-slate-200 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(run => (
                <RunRow
                  key={run.id}
                  run={run}
                  expanded={expanded === run.id}
                  onToggle={() => setExpanded(e => e === run.id ? null : run.id)}
                  onSubmit={(result, notes) => onSubmitResult(run.id, result, notes)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showReport && (
        <CycleReportModal cycleId={cycle.id} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}

function ProgressWidget({ summary, cycle }: { summary: CycleSummary | null; cycle: TestCycle }) {
  const total = summary?.total ?? 0;
  const done = summary?.done ?? 0;
  const counts = summary?.counts ?? { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
  const passPercent = total === 0 ? 0 : Math.round((counts.Passed / total) * 100);
  const scopeTone =
    cycle.scopeType === 'All'     ? 'bg-slate-100 text-slate-600' :
    cycle.scopeType === 'Module'  ? 'bg-indigo-50 text-indigo-700' :
    cycle.scopeType === 'Feature' ? 'bg-blue-50 text-blue-700' :
                                    'bg-amber-50 text-amber-700';

  return (
    <div className="px-6 py-4 bg-white border-b border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900">{cycle.name}</h1>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Scope:</span>
            <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-px rounded ${scopeTone}`}>
              {cycle.scopeType}
            </span>
            <span className="text-xs text-slate-700 truncate" title={cycle.scopeName ?? undefined}>
              {cycle.scopeName ?? '—'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">{done} of {total} runs complete</p>
        </div>
        <div className="text-right ml-4">
          <div className="text-2xl font-bold text-green-600">{passPercent}%</div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Pass rate</p>
        </div>
      </div>

      <SegmentedProgressBar counts={counts} total={total} height={10} />

      <div className="flex items-center gap-3 mt-3 text-xs">
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />
          Not run <span className="font-semibold text-slate-700">{counts.NotRun}</span>
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          Passed <span className="font-semibold text-green-700">{counts.Passed}</span>
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
          Failed <span className="font-semibold text-red-700">{counts.Failed}</span>
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
          Blocked <span className="font-semibold text-amber-700">{counts.Blocked}</span>
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
          Skipped <span className="font-semibold text-slate-700">{counts.Skipped}</span>
        </span>
      </div>
    </div>
  );
}

interface SegBarProps {
  counts: { Passed: number; Failed: number; Blocked: number; Skipped: number; NotRun: number };
  total: number;
  height?: number;
}

export function SegmentedProgressBar({ counts, total, height = 6 }: SegBarProps) {
  const pct = (n: number) => total === 0 ? 0 : (n / total) * 100;
  const segments = [
    { color: 'bg-green-500',  width: pct(counts.Passed),  title: `Passed: ${counts.Passed}` },
    { color: 'bg-red-500',    width: pct(counts.Failed),  title: `Failed: ${counts.Failed}` },
    { color: 'bg-amber-500',  width: pct(counts.Blocked), title: `Blocked: ${counts.Blocked}` },
    { color: 'bg-slate-400',  width: pct(counts.Skipped), title: `Skipped: ${counts.Skipped}` },
  ];
  return (
    <div
      className="rounded-full bg-slate-100 overflow-hidden flex"
      style={{ height }}
    >
      {segments.map((s, i) => s.width > 0 && (
        <div
          key={i}
          title={s.title}
          className={`h-full ${s.color} transition-all`}
          style={{ width: `${s.width}%` }}
        />
      ))}
    </div>
  );
}

interface RunRowProps {
  run: ApiTestRun;
  expanded: boolean;
  onToggle: () => void;
  onSubmit: (result: RunResult, notes?: string) => Promise<void>;
}

function RunRow({ run, expanded, onToggle, onSubmit }: RunRowProps) {
  const [notes, setNotes] = useState(run.notes);
  const [saving, setSaving] = useState<RunResult | null>(null);
  const tc = run.testCase;

  const handleClick = async (result: RunResult) => {
    setSaving(result);
    try {
      await onSubmit(result, notes);
    } finally {
      setSaving(null);
    }
  };

  const stepsArray = Array.isArray(tc.steps) ? tc.steps as string[] : [String(tc.steps ?? '')];
  const isHtml = stepsArray.length === 1 && /<\/?[a-z][\s\S]*>/i.test(stepsArray[0]);

  return (
    <>
      {/* Main row */}
      <tr
        onClick={onToggle}
        className="border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors"
      >
        <td className="px-3 py-2.5 w-6 text-[10px] text-slate-400">{expanded ? '▼' : '▶'}</td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          <span className="font-mono text-[11px] text-slate-400 font-semibold">
            TC-{String(tc.caseNum).padStart(4, '0')}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <span className="block font-semibold text-slate-900 max-w-[320px] truncate">{tc.title}</span>
          <span className="block text-[11px] text-slate-400 max-w-[320px] truncate">
            {tc.feature?.module.name} · {tc.feature?.name}
          </span>
        </td>
        <td className="px-3 py-2.5"><Badge className={priorityBadge(tc.priority)}>{tc.priority}</Badge></td>
        <td className="px-3 py-2.5"><Badge className={severityBadge(tc.severity)}>{tc.severity}</Badge></td>
        <td className="px-3 py-2.5"><Badge className={typeBadge(tc.type)}>{tc.type}</Badge></td>
        <td className="px-3 py-2.5">
          <Badge className={RESULT_BADGE[run.result]}>
            {run.result === 'NotRun' ? 'Not run' : run.result}
          </Badge>
        </td>
      </tr>

      {/* Expanded details row */}
      {expanded && (
        <tr className="bg-slate-50 border-b border-slate-100" onClick={e => e.stopPropagation()}>
          <td colSpan={7} className="px-6 pb-5 pt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1.5">Description</p>
                <p className="text-sm text-slate-700 leading-relaxed">{tc.desc || '—'}</p>

                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1.5 mt-4">Steps</p>
                {isHtml ? (
                  <div className="rich-editor text-sm text-slate-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: stepsArray[0] }} />
                ) : (
                  <ol className="text-sm text-slate-700 leading-relaxed list-decimal pl-5 space-y-1">
                    {stepsArray.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                )}

                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1.5 mt-4">Expected result</p>
                <p className="text-sm text-slate-700 leading-relaxed">{tc.expected || '—'}</p>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1.5">Notes</p>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={4}
                    placeholder="Add any observations, failure details, or links…"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900 outline-none resize-y focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-2">Submit result</p>
                  <div className="grid grid-cols-2 gap-2">
                    {RESULTS.map(r => (
                      <button
                        key={r}
                        onClick={() => handleClick(r)}
                        disabled={saving !== null}
                        className={`px-3 py-2 border rounded-lg text-xs font-semibold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed ${RESULT_BTN[r]} ${
                          run.result === r ? 'ring-2 ring-blue-200' : ''
                        }`}
                      >
                        {saving === r ? 'Saving…' : r}
                      </button>
                    ))}
                  </div>
                  {run.result !== 'NotRun' && (
                    <button
                      onClick={() => handleClick('NotRun')}
                      disabled={saving !== null}
                      className="mt-2 px-3 py-1.5 border border-slate-200 rounded-lg text-[11px] text-slate-500 hover:bg-slate-100 cursor-pointer w-full"
                    >
                      Reset to Not run
                    </button>
                  )}
                  {run.executedAt && (
                    <p className="text-[10px] text-slate-400 mt-2">
                      Last submitted: {new Date(run.executedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
