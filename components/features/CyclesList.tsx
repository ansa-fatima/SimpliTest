'use client';

import { useState } from 'react';
import { TestCycle, CycleStatus } from '@/types';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { NewCycleModal } from './NewCycleModal';
import { SegmentedProgressBar } from './CycleView';
import { CycleReportModal } from './CycleReportModal';
import { Module } from '@/types';

interface CyclesListProps {
  cycles: TestCycle[];
  loading: boolean;
  modules: Module[];
  projectId: string | null;
  onOpen: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: (input: any) => Promise<void>;
}

const STATUS_BADGE: Record<CycleStatus, string> = {
  Active: 'bg-blue-50 text-blue-700 border border-blue-200',
  Completed: 'bg-green-50 text-green-700 border border-green-200',
  Archived: 'bg-slate-100 text-slate-500 border border-slate-200',
};

export function CyclesList({
  cycles,
  loading,
  modules,
  projectId,
  onOpen,
  onArchive,
  onDelete,
  onCreate,
}: CyclesListProps) {
  const [filter, setFilter] = useState<CycleStatus | 'All'>('All');
  const [showCreate, setShowCreate] = useState(false);
  const [reportFor, setReportFor] = useState<string | null>(null);

  const filtered = filter === 'All' ? cycles : cycles.filter(c => c.status === filter);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 pb-3 pt-4">
        <div className="mb-2 flex items-start justify-between">
          <div>
            <div className="mb-1 text-xs text-slate-400">Test execution</div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">Test Runs</h1>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-0.5 text-xs text-slate-500">
                {cycles.length} run{cycles.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            New Test Run
          </Button>
        </div>

        {/* Status filter */}
        <div className="mt-2 flex items-center gap-1.5">
          {(['All', 'Active', 'Completed', 'Archived'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs transition-colors ${
                filter === s
                  ? 'bg-blue-600 font-semibold text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-sm text-slate-400">
            Loading cycles…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-400">
            <span className="text-4xl opacity-40">🧪</span>
            <p className="text-sm font-semibold text-slate-500">No test runs yet</p>
            <p className="max-w-[280px] text-center text-xs">
              Create a test run to bundle a snapshot of test cases and execute them together.
            </p>
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              + New Test Run
            </Button>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {['Name', 'Scope', 'Status', 'Progress', 'Created', ''].map((h, i) => (
                  <th
                    key={i}
                    className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const summary = c.summary;
                const total = summary?.total ?? 0;
                const counts = summary?.counts ?? {
                  NotRun: 0,
                  Passed: 0,
                  Failed: 0,
                  Blocked: 0,
                  Skipped: 0,
                };
                const passPercent = total === 0 ? 0 : Math.round((counts.Passed / total) * 100);
                return (
                  <tr
                    key={c.id}
                    onClick={() => onOpen(c.id)}
                    className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      <span className="block font-semibold text-slate-900">{c.name}</span>
                      {c.description && (
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {c.description}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      <Scope cycle={c} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_BADGE[c.status]}>{c.status}</Badge>
                    </td>
                    <td className="min-w-[200px] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <SegmentedProgressBar counts={counts} total={total} height={6} />
                        </div>
                        <span className="w-[60px] text-right font-mono text-[11px] font-semibold text-green-700">
                          {passPercent}% pass
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setReportFor(c.id)}
                          className="cursor-pointer rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                          title="View summary you can copy or screenshot"
                        >
                          Summary
                        </button>
                        <button
                          onClick={() => onOpen(c.id)}
                          className="cursor-pointer rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
                        >
                          Open
                        </button>
                        {c.status !== 'Archived' && (
                          <button
                            onClick={() => {
                              if (
                                confirm(
                                  `Archive "${c.name}"? It will be hidden from the active list.`,
                                )
                              )
                                onArchive(c.id);
                            }}
                            className="cursor-pointer rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"
                          >
                            Archive
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                `Permanently delete "${c.name}" and all its runs?\n\nThis cannot be undone.`,
                              )
                            )
                              onDelete(c.id);
                          }}
                          className="cursor-pointer rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <NewCycleModal
          modules={modules}
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onSave={async input => {
            await onCreate(input);
            setShowCreate(false);
          }}
        />
      )}

      {reportFor && <CycleReportModal cycleId={reportFor} onClose={() => setReportFor(null)} />}
    </div>
  );
}

function Scope({ cycle }: { cycle: TestCycle }) {
  const label = cycle.scopeName ?? cycle.scopeType;
  const tone =
    cycle.scopeType === 'All'
      ? 'bg-slate-100 text-slate-600'
      : cycle.scopeType === 'Module'
        ? 'bg-indigo-50 text-indigo-700'
        : cycle.scopeType === 'Suite'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-amber-50 text-amber-700';
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={`inline-block w-fit rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${tone}`}
      >
        {cycle.scopeType}
      </span>
      <span className="max-w-[200px] truncate text-[11px] text-slate-700" title={label}>
        {label}
      </span>
    </div>
  );
}
