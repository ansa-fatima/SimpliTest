'use client';

import { useEffect, useRef, useState } from 'react';
import { TestCase, Priority, Severity, TestType } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { priorityBadge, severityBadge, typeBadge } from '@/lib/utils';
import { exportTestCases } from '@/lib/export';

interface TestCaseListProps {
  currentKey: string;
  cases: TestCase[];
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowCreate: () => void;
}

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
const SEVERITIES: Severity[] = ['Critical', 'Major', 'Minor'];
const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];

type FilterKey = 'Priority' | 'Severity' | 'Type';

export function TestCaseList({
  currentKey,
  cases,
  onView,
  onEdit,
  onDelete,
  onShowCreate,
}: TestCaseListProps) {
  const [search, setSearch] = useState('');
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const [priorityFilter, setPriorityFilter] = useState<Set<Priority>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<TestType>>(new Set());

  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);

  // Click outside closes any open dropdown
  useEffect(() => {
    if (!openFilter) return;
    const handler = (e: MouseEvent) => {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openFilter]);

  const [mod, feat] = currentKey ? currentKey.split(':') : ['', ''];

  // No folder selected — empty workspace
  if (!currentKey || !mod || !feat) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
        <div className="border-b border-slate-200 bg-white px-6 pb-3 pt-4">
          <h1 className="text-xl font-bold text-slate-900">Test Cases</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Select a folder from the sidebar to view test cases.
          </p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-slate-400">
          <span className="text-4xl opacity-40">📁</span>
          <p className="text-sm font-semibold text-slate-500">No folder selected</p>
          <p className="max-w-[300px] text-center text-xs">
            Create your first folder using the <strong>+ New folder</strong> button in the sidebar,
            or hover any existing folder to add a sub-folder.
          </p>
        </div>
      </div>
    );
  }

  const filtered = cases.filter(c => {
    if (priorityFilter.size > 0 && !priorityFilter.has(c.priority)) return false;
    if (severityFilter.size > 0 && !severityFilter.has(c.severity)) return false;
    if (typeFilter.size > 0 && !typeFilter.has(c.type)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !c.title.toLowerCase().includes(q) &&
        !c.id.toLowerCase().includes(q) &&
        !c.sub.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const high = cases.filter(c => c.priority === 'High').length;
  const med = cases.filter(c => c.priority === 'Medium').length;

  const activeFilterCount = priorityFilter.size + severityFilter.size + typeFilter.size;
  const clearAllFilters = () => {
    setPriorityFilter(new Set());
    setSeverityFilter(new Set());
    setTypeFilter(new Set());
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 pb-0 pt-4">
        <div className="mb-2 flex items-start justify-between">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
              <svg
                width="11"
                height="11"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <rect x="2" y="4" width="12" height="9" rx="1.5" />
                <path d="M5 4V3a3 3 0 0 1 6 0v1" />
              </svg>
              <span>{mod}</span>
              <span>/</span>
              <span className="font-semibold text-slate-700">{feat}</span>
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">{feat}</h1>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-0.5 text-xs text-slate-500">
                {cases.length} test case{cases.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="default" onClick={() => exportTestCases(filtered, mod, feat)}>
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
            <Button variant="primary" onClick={onShowCreate}>
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
              New test case
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-4 pb-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-600" />
            {high} High priority
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
            {med} Medium
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="inline-block h-2 w-2 rounded-full bg-slate-300" />
            Last updated 2 hours ago
          </span>
        </div>
      </div>

      {/* Filter bar */}
      <div
        ref={filterBarRef}
        className="relative flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-6 py-2.5"
      >
        <div className="relative max-w-[280px] flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-slate-400">
            🔍
          </span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search test cases…"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-3 font-sans text-xs text-slate-900 outline-none focus:border-blue-500"
          />
        </div>

        <FilterButton
          label="Priority"
          options={PRIORITIES}
          selected={priorityFilter}
          onToggle={v => {
            const next = new Set(priorityFilter);
            next.has(v) ? next.delete(v) : next.add(v);
            setPriorityFilter(next);
          }}
          onClear={() => setPriorityFilter(new Set())}
          isOpen={openFilter === 'Priority'}
          onOpen={() => setOpenFilter(openFilter === 'Priority' ? null : 'Priority')}
        />
        <FilterButton
          label="Severity"
          options={SEVERITIES}
          selected={severityFilter}
          onToggle={v => {
            const next = new Set(severityFilter);
            next.has(v) ? next.delete(v) : next.add(v);
            setSeverityFilter(next);
          }}
          onClear={() => setSeverityFilter(new Set())}
          isOpen={openFilter === 'Severity'}
          onOpen={() => setOpenFilter(openFilter === 'Severity' ? null : 'Severity')}
        />
        <FilterButton
          label="Type"
          options={TYPES}
          selected={typeFilter}
          onToggle={v => {
            const next = new Set(typeFilter);
            next.has(v) ? next.delete(v) : next.add(v);
            setTypeFilter(next);
          }}
          onClear={() => setTypeFilter(new Set())}
          isOpen={openFilter === 'Type'}
          onOpen={() => setOpenFilter(openFilter === 'Type' ? null : 'Type')}
        />

        {activeFilterCount > 0 && (
          <button
            onClick={clearAllFilters}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-200"
          >
            Clear all
          </button>
        )}

        <span className="ml-auto text-xs text-slate-400">
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-slate-400">
            <span className="text-4xl opacity-40">📋</span>
            <p className="text-sm font-semibold text-slate-500">No test cases found</p>
            <p className="max-w-[240px] text-center text-xs">
              {search || activeFilterCount > 0
                ? 'Try a different search term or clear filters.'
                : 'Click "New test case" to create the first one.'}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {['', 'ID', 'Title', 'Priority', 'Severity', 'Type', 'Feature', 'Updated', ''].map(
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
              {filtered.map(tc => (
                <tr
                  key={tc.id}
                  onClick={() => onView(tc.id)}
                  onMouseEnter={() => setHoveredRow(tc.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50"
                >
                  <td className="w-9 px-3 py-2.5">
                    <input
                      type="checkbox"
                      onClick={e => e.stopPropagation()}
                      className="h-3.5 w-3.5 cursor-pointer accent-blue-600"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-slate-400">
                      {tc.id}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="max-w-[220px]">
                      <TruncatedText text={tc.title} className="font-semibold text-slate-900" />
                      <TruncatedText text={tc.sub} className="text-[11px] text-slate-400" />
                    </div>
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
                  <td className="px-3 py-2.5 text-slate-400">
                    <div className="max-w-[160px]">
                      <TruncatedText text={tc.feature} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-400">{tc.updated}</td>
                  <td className="px-3 py-2.5">
                    {hoveredRow === tc.id && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            onEdit(tc.id);
                          }}
                          className="cursor-pointer rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
                        >
                          Edit
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            onDelete(tc.id);
                          }}
                          className="cursor-pointer rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                        >
                          Del
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface FilterButtonProps<T extends string> {
  label: string;
  options: T[];
  selected: Set<T>;
  onToggle: (value: T) => void;
  onClear: () => void;
  isOpen: boolean;
  onOpen: () => void;
}

function FilterButton<T extends string>({
  label,
  options,
  selected,
  onToggle,
  onClear,
  isOpen,
  onOpen,
}: FilterButtonProps<T>) {
  const count = selected.size;
  return (
    <div className="relative">
      <button
        onClick={onOpen}
        className={`flex cursor-pointer items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
          count > 0
            ? 'border-blue-400 bg-blue-50 font-semibold text-blue-700'
            : 'border-slate-200 bg-white text-slate-500 hover:border-blue-400 hover:text-blue-600'
        }`}
      >
        {label}
        {count > 0 && (
          <span className="ml-1 rounded-full bg-blue-600 px-1.5 py-px font-mono text-[10px] text-white">
            {count}
          </span>
        )}
        <span className="ml-0.5 text-[10px]">{isOpen ? '▴' : '▾'}</span>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-[180px] rounded-lg border border-slate-200 bg-white py-1.5 shadow-lg">
          {options.map(opt => {
            const checked = selected.has(opt);
            return (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(opt)}
                  className="h-3.5 w-3.5 cursor-pointer accent-blue-600"
                />
                <span className="text-slate-700">{opt}</span>
              </label>
            );
          })}
          {count > 0 && (
            <>
              <hr className="my-1 border-slate-100" />
              <button
                onClick={onClear}
                className="w-full cursor-pointer px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
