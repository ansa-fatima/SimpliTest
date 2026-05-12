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
  NotRun: 'bg-slate-100 text-slate-500 border border-slate-200',
  Passed: 'bg-green-50 text-green-700 border border-green-200',
  Failed: 'bg-red-50 text-red-700 border border-red-200',
  Blocked: 'bg-amber-50 text-amber-700 border border-amber-200',
  Skipped: 'bg-slate-50 text-slate-500 border border-slate-200',
};

const RESULT_BTN: Record<RunResult, string> = {
  NotRun: 'border-slate-200 text-slate-500 hover:bg-slate-50',
  Passed: 'border-green-200 text-green-700 hover:bg-green-50',
  Failed: 'border-red-200 text-red-700 hover:bg-red-50',
  Blocked: 'border-amber-200 text-amber-700 hover:bg-amber-50',
  Skipped: 'border-slate-200 text-slate-500 hover:bg-slate-50',
};

export function CycleView({
  cycle,
  runs,
  summary,
  loading,
  onBack,
  onSubmitResult,
}: CycleViewProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunResult | 'All'>('All');
  const [showReport, setShowReport] = useState(false);

  const filtered = filter === 'All' ? runs : runs.filter(r => r.result === filter);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Topbar */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <button
          onClick={onBack}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-100"
        >
          ← Back to Test Runs
        </button>
        <div className="flex-1 text-xs text-slate-400">
          Test Runs / <span className="font-semibold text-slate-800">{cycle.name}</span>
        </div>
        <Button variant="default" onClick={() => setShowReport(true)}>
          📋 Summary
        </Button>
        <Button variant="default" onClick={() => exportCycleResults(cycle, runs)}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path d="M3 10v3h10v-3M8 2v8M5 7l3 3 3-3" />
          </svg>
          Export .xlsx
        </Button>
      </div>

      {/* Progress widget (header bar) */}
      <ProgressWidget summary={summary} cycle={cycle} />

      {/* Result filter */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-6 py-2.5">
        {(['All', 'NotRun', 'Passed', 'Failed', 'Blocked', 'Skipped'] as const).map(r => {
          const count = r === 'All' ? runs.length : (summary?.counts[r as RunResult] ?? 0);
          return (
            <button
              key={r}
              onClick={() => setFilter(r)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs transition-colors ${
                filter === r
                  ? 'bg-blue-600 font-semibold text-white'
                  : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
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
          <div className="flex items-center justify-center py-24 text-sm text-slate-400">
            Loading runs…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-400">
            <p className="text-sm font-semibold text-slate-500">
              {runs.length === 0
                ? 'No runs in this cycle'
                : `No ${filter === 'NotRun' ? 'not run' : filter.toLowerCase()} runs`}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {['', 'Case ID', 'Title', 'Priority', 'Severity', 'Test Type', 'Status'].map(
                  (h, i) => (
                    <th
                      key={i}
                      className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map(run => (
                <RunRow
                  key={run.id}
                  run={run}
                  expanded={expanded === run.id}
                  onToggle={() => setExpanded(e => (e === run.id ? null : run.id))}
                  onSubmit={(result, notes) => onSubmitResult(run.id, result, notes)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showReport && <CycleReportModal cycleId={cycle.id} onClose={() => setShowReport(false)} />}
    </div>
  );
}

function ProgressWidget({ summary, cycle }: { summary: CycleSummary | null; cycle: TestCycle }) {
  const total = summary?.total ?? 0;
  const done = summary?.done ?? 0;
  const counts = summary?.counts ?? { NotRun: 0, Passed: 0, Failed: 0, Blocked: 0, Skipped: 0 };
  const passPercent = total === 0 ? 0 : Math.round((counts.Passed / total) * 100);
  const scopeTone =
    cycle.scopeType === 'All'
      ? 'bg-slate-100 text-slate-600'
      : cycle.scopeType === 'Module'
        ? 'bg-indigo-50 text-indigo-700'
        : cycle.scopeType === 'Feature'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-amber-50 text-amber-700';

  return (
    <div className="border-b border-slate-200 bg-white px-6 py-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-slate-900">{cycle.name}</h1>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Scope:
            </span>
            <span
              className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${scopeTone}`}
            >
              {cycle.scopeType}
            </span>
            <span className="truncate text-xs text-slate-700" title={cycle.scopeName ?? undefined}>
              {cycle.scopeName ?? '—'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {done} of {total} runs complete
          </p>
        </div>
        <div className="ml-4 text-right">
          <div className="text-2xl font-bold text-green-600">{passPercent}%</div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Pass rate
          </p>
        </div>
      </div>

      <SegmentedProgressBar counts={counts} total={total} height={10} />

      <div className="mt-3 flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-300" />
          Not run <span className="font-semibold text-slate-700">{counts.NotRun}</span>
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          Passed <span className="font-semibold text-green-700">{counts.Passed}</span>
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
          Failed <span className="font-semibold text-red-700">{counts.Failed}</span>
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          Blocked <span className="font-semibold text-amber-700">{counts.Blocked}</span>
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
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
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const segments = [
    { color: 'bg-green-500', width: pct(counts.Passed), title: `Passed: ${counts.Passed}` },
    { color: 'bg-red-500', width: pct(counts.Failed), title: `Failed: ${counts.Failed}` },
    { color: 'bg-amber-500', width: pct(counts.Blocked), title: `Blocked: ${counts.Blocked}` },
    { color: 'bg-slate-400', width: pct(counts.Skipped), title: `Skipped: ${counts.Skipped}` },
  ];
  return (
    <div className="flex overflow-hidden rounded-full bg-slate-100" style={{ height }}>
      {segments.map(
        (s, i) =>
          s.width > 0 && (
            <div
              key={i}
              title={s.title}
              className={`h-full ${s.color} transition-all`}
              style={{ width: `${s.width}%` }}
            />
          ),
      )}
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

  const stepsArray = Array.isArray(tc.steps) ? (tc.steps as string[]) : [String(tc.steps ?? '')];
  const isHtml = stepsArray.length === 1 && /<\/?[a-z][\s\S]*>/i.test(stepsArray[0]);

  return (
    <>
      {/* Main row */}
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50"
      >
        <td className="w-6 px-3 py-2.5 text-[10px] text-slate-400">{expanded ? '▼' : '▶'}</td>
        <td className="whitespace-nowrap px-3 py-2.5">
          <span className="font-mono text-[11px] font-semibold text-slate-400">
            TC-{String(tc.caseNum).padStart(4, '0')}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <span className="block max-w-[320px] truncate font-semibold text-slate-900">
            {tc.title}
          </span>
          <span className="block max-w-[320px] truncate text-[11px] text-slate-400">
            {tc.feature?.module.name} · {tc.feature?.name}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <Badge className={priorityBadge(tc.priority)}>{tc.priority}</Badge>
        </td>
        <td className="px-3 py-2.5">
          <Badge className={severityBadge(tc.severity)}>{tc.severity}</Badge>
        </td>
        <td className="px-3 py-2.5">
          <Badge className={typeBadge(tc.type)}>{tc.type}</Badge>
        </td>
        <td className="px-3 py-2.5">
          <Badge className={RESULT_BADGE[run.result]}>
            {run.result === 'NotRun' ? 'Not run' : run.result}
          </Badge>
        </td>
      </tr>

      {/* Expanded details row */}
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50" onClick={e => e.stopPropagation()}>
          <td colSpan={7} className="px-6 pb-5 pt-3">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Description
                </p>
                <p className="text-sm leading-relaxed text-slate-700">{tc.desc || '—'}</p>

                <p className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Steps
                </p>
                {isHtml ? (
                  <div
                    className="rich-editor text-sm leading-relaxed text-slate-700"
                    dangerouslySetInnerHTML={{ __html: stepsArray[0] }}
                  />
                ) : (
                  <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
                    {stepsArray.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                )}

                <p className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Expected result
                </p>
                <p className="text-sm leading-relaxed text-slate-700">{tc.expected || '—'}</p>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Notes
                  </p>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={4}
                    placeholder="Add any observations, failure details, or links…"
                    className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Submit result
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {RESULTS.map(r => (
                      <button
                        key={r}
                        onClick={() => handleClick(r)}
                        disabled={saving !== null}
                        className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${RESULT_BTN[r]} ${
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
                      className="mt-2 w-full cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] text-slate-500 hover:bg-slate-100"
                    >
                      Reset to Not run
                    </button>
                  )}
                  {run.executedAt && (
                    <p className="mt-2 text-[10px] text-slate-400">
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
