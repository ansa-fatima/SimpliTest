'use client';

import { useEffect } from 'react';
import { TestCase } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { priorityBadge, severityBadge, typeBadge } from '@/lib/utils';

interface TestCaseViewProps {
  tc: TestCase;
  cases: TestCase[];
  currentKey: string;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onView: (id: string) => void;
}

export function TestCaseView({
  tc,
  cases,
  currentKey,
  onBack,
  onEdit,
  onDelete,
  onDuplicate,
  onView,
}: TestCaseViewProps) {
  const [mod, feat] = currentKey.split(':');

  const currentIndex = cases.findIndex(c => c.id === tc.id);
  const total = cases.length;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < total - 1;

  const goPrev = () => {
    if (hasPrev) onView(cases[currentIndex - 1].id);
  };
  const goNext = () => {
    if (hasNext) onView(cases[currentIndex + 1].id);
  };

  // Keyboard shortcuts: Left/Right arrows navigate between cases.
  // Skipped when typing in an input/textarea/contenteditable element.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return;
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentIndex, total]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Topbar */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <button
          onClick={onBack}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-100"
        >
          ← Back
        </button>

        {/* Prev / Next navigation */}
        <div className="ml-2 flex items-center gap-1">
          <button
            onClick={goPrev}
            disabled={!hasPrev}
            title="Previous test case (←)"
            className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M10 3L5 8l5 5" />
            </svg>
            Prev
          </button>
          <span className="whitespace-nowrap px-1.5 font-mono text-[11px] text-slate-400">
            {currentIndex >= 0 ? `${currentIndex + 1} of ${total}` : `— of ${total}`}
          </span>
          <button
            onClick={goNext}
            disabled={!hasNext}
            title="Next test case (→)"
            className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Next
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
        </div>

        <div className="ml-2 flex-1 truncate text-xs text-slate-400">
          {mod} / {feat} / <span className="font-mono font-semibold text-slate-800">{tc.id}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="danger" onClick={onDelete}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M10 8v5M6 8v5M3 4l1 9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-9" />
            </svg>
            Delete
          </Button>
          <Button variant="default" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="primary" onClick={onEdit}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path d="M11 2l3 3-9 9H2v-3L11 2z" />
            </svg>
            Edit
          </Button>
        </div>
      </div>

      {/* Props bar */}
      <div className="flex flex-wrap border-b border-slate-200 bg-white">
        {[
          {
            label: 'Case ID',
            content: (
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-600">
                {tc.id}
              </span>
            ),
          },
          {
            label: 'Module',
            content: <span className="text-xs font-semibold text-slate-800">{mod}</span>,
          },
          {
            label: 'Feature',
            content: <span className="text-xs font-semibold text-slate-800">{tc.feature}</span>,
          },
          {
            label: 'Priority',
            content: <Badge className={priorityBadge(tc.priority)}>{tc.priority}</Badge>,
          },
          {
            label: 'Severity',
            content: <Badge className={severityBadge(tc.severity)}>{tc.severity}</Badge>,
          },
          { label: 'Test type', content: <Badge className={typeBadge(tc.type)}>{tc.type}</Badge> },
        ].map(({ label, content }) => (
          <div
            key={label}
            className="flex flex-col gap-1 border-r border-slate-100 px-4 py-2.5 last:border-r-0"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {label}
            </span>
            {content}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
        {/* Title */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Title
          </p>
          <h2 className="text-lg font-bold text-slate-900">{tc.title}</h2>
        </div>
        <hr className="border-slate-100" />

        {/* Description */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Description
          </p>
          <p className="text-sm leading-relaxed text-slate-700">{tc.desc || '—'}</p>
        </div>
        <hr className="border-slate-100" />

        {/* Steps */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Steps
          </p>
          {tc.steps.length === 1 && /<\/?[a-z][\s\S]*>/i.test(tc.steps[0]) ? (
            <div
              className="rich-editor text-sm leading-relaxed text-slate-700"
              dangerouslySetInnerHTML={{ __html: tc.steps[0] }}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {tc.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-blue-700">
                    {i + 1}
                  </span>
                  <p className="flex-1 text-sm leading-relaxed text-slate-700">{step}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <hr className="border-slate-100" />

        {/* Expected result */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Expected result
          </p>
          <p className="text-sm leading-relaxed text-slate-700">{tc.expected || '—'}</p>
        </div>
        <hr className="border-slate-100" />

        {/* Meta */}
        <div className="flex items-center gap-5">
          <span className="text-xs text-slate-400">📅 Created {tc.created}</span>
          <span className="text-xs text-slate-400">👤 {tc.author}</span>
          <span className="text-xs text-slate-400">✏️ Updated {tc.updatedFull}</span>
        </div>
      </div>
    </div>
  );
}
