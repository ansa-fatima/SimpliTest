'use client';

import { useEffect, useState } from 'react';
import { TestCase, RunResult } from '@/types';
import { api } from '@/lib/client';
import { Badge } from '@/components/ui/Badge';
import { RichText } from '@/components/ui/RichText';
import {
  cn,
  formatBytes,
  priorityBadge,
  relativeTime,
  resultTone,
  severityBadge,
  typeBadge,
} from '@/lib/utils';

interface TestCaseViewProps {
  tc: TestCase;
  cases: TestCase[];
  currentKey: string;
  projectId: string | null;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: (targetSuiteId?: string) => void;
  onView: (id: string) => void;
}

interface RunHistoryItem {
  id: string;
  result: RunResult;
  ts: string;
  cycleId: string;
  cycleName: string;
}

export function TestCaseView({
  tc,
  cases,
  projectId,
  onBack,
  onEdit,
  onDelete,
  onDuplicate,
  onView,
}: TestCaseViewProps) {
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

  // Execution history -- every real run recorded against this case.
  const [runs, setRuns] = useState<RunHistoryItem[] | null>(null);
  useEffect(() => {
    setRuns(null);
    if (!tc.apiId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<{ items: RunHistoryItem[] }>(`/api/test-cases/${tc.apiId}/runs`);
        if (!cancelled) setRuns(data.items);
      } catch {
        if (!cancelled) setRuns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tc.apiId]);

  const [showCopyTo, setShowCopyTo] = useState(false);
  const [copying, setCopying] = useState(false);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      {/* Nav bar */}
      <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2">
        <button
          onClick={onBack}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-surface-2"
        >
          ← Back
        </button>

        <div className="ml-2 flex items-center gap-1">
          <button
            onClick={goPrev}
            disabled={!hasPrev}
            title="Previous test case (←)"
            className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-text-2 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
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
          <span className="whitespace-nowrap px-1.5 font-mono text-[11px] text-text-3">
            {currentIndex >= 0 ? `${currentIndex + 1} of ${total}` : `— of ${total}`}
          </span>
          <button
            onClick={goNext}
            disabled={!hasNext}
            title="Next test case (→)"
            className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-text-2 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[1120px]">
          {/* Header */}
          <div className="mb-4 flex flex-nowrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[12px] text-text-3">{tc.id}</p>
              <h1 className="mt-0.5 text-[18px] font-semibold leading-snug text-text">
                {tc.title}
              </h1>
              <p className="mt-1.5 truncate text-[12.5px] text-text-3">
                {[tc.portal, tc.module, tc.feature].filter(Boolean).join(' → ')}
              </p>
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCopyTo(true)}
                className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-[7px] text-[13px] text-text transition-colors hover:bg-surface-2"
              >
                <i className="ti ti-copy text-[15px]" />
                Copy
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-[7px] text-[13px] font-medium text-text transition-colors hover:bg-surface-2"
              >
                <i className="ti ti-pencil text-[15px]" />
                Edit
              </button>
              <button
                type="button"
                onClick={onDelete}
                title="Delete test case"
                aria-label="Delete test case"
                className="flex h-[33px] w-[33px] flex-shrink-0 items-center justify-center rounded-[7px] border border-danger/20 bg-danger-bg text-danger transition-colors hover:bg-danger/10"
              >
                <i className="ti ti-trash text-[15px]" />
              </button>
            </div>
          </div>

          {/* Two-column body */}
          <div className="flex flex-col gap-3.5 lg:flex-row lg:items-start lg:gap-4">
            {/* Main column */}
            <div className="flex min-w-0 flex-1 flex-col gap-3.5">
              <Card title="Description">
                <RichText text={tc.desc} />
              </Card>

              <Card title="Preconditions">
                <RichText text={tc.preconditions} />
              </Card>

              <Card title="Test Steps">
                {tc.steps.length === 0 ? (
                  <p className="text-[13px] text-text-3">—</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full border-collapse text-[13px]">
                      <thead className="bg-surface-2">
                        <tr>
                          <th className="w-[40px] border-b border-border px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-text-3">
                            #
                          </th>
                          <th className="border-b border-border px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-text-3">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {tc.steps.map((step, i) => (
                          <tr key={i} className="border-b border-border last:border-b-0">
                            <td className="px-3 py-2.5 align-top text-text-3">{i + 1}</td>
                            <td className="px-3 py-2.5 align-top">
                              <RichText text={step} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title="Expected Result">
                <RichText text={tc.expected} />
              </Card>

              {tc.attachments.length > 0 && (
                <Card title="Attachments">
                  <div className="flex flex-col gap-1.5">
                    {tc.attachments.map((a, i) => (
                      <a
                        key={`${a.name}-${i}`}
                        href={a.dataUrl}
                        download={a.name}
                        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 transition-colors hover:bg-surface-2"
                      >
                        <i className="ti ti-paperclip flex-shrink-0 text-[13px] text-text-3" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">
                          {a.name}
                        </span>
                        <span className="flex-shrink-0 text-[10.5px] text-text-3">
                          {formatBytes(a.size)}
                        </span>
                      </a>
                    ))}
                  </div>
                </Card>
              )}

              <Card title="Execution History">
                {runs === null ? (
                  <p className="text-[13px] text-text-3">Loading…</p>
                ) : runs.length === 0 ? (
                  <p className="text-[13px] text-text-3">No runs recorded yet.</p>
                ) : (
                  <div className="flex flex-col divide-y divide-border">
                    {runs.map(r => {
                      const t = resultTone(r.result === 'NotRun' ? null : r.result);
                      return (
                        <div
                          key={r.id}
                          className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0 truncate text-[13px] text-text">
                            {r.cycleName}
                          </span>
                          <span className="flex flex-shrink-0 items-center gap-3">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 text-[12.5px] font-medium',
                                t.text,
                              )}
                            >
                              <span
                                className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', t.dot)}
                              />
                              {t.label}
                            </span>
                            <span className="text-[11px] text-text-3">{relativeTime(r.ts)}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* Right rail */}
            <div className="flex w-full flex-shrink-0 flex-col gap-3.5 lg:w-[320px]">
              <Card title="Details">
                <div className="flex flex-col gap-2.5">
                  <DetailRow label="Priority">
                    <Badge className={priorityBadge(tc.priority)}>{tc.priority}</Badge>
                  </DetailRow>
                  <DetailRow label="Severity">
                    <Badge className={severityBadge(tc.severity)}>{tc.severity}</Badge>
                  </DetailRow>
                  <DetailRow label="Type">
                    <Badge className={typeBadge(tc.type)}>{tc.type}</Badge>
                  </DetailRow>
                  <DetailRow label="Portal">
                    <span className="truncate text-[12.5px] text-text">{tc.portal || '—'}</span>
                  </DetailRow>
                  <DetailRow label="Module">
                    <span className="truncate text-[12.5px] text-text">{tc.module || '—'}</span>
                  </DetailRow>
                  <DetailRow label="Suite">
                    <span className="truncate text-[12.5px] text-text">{tc.feature || '—'}</span>
                  </DetailRow>
                  <hr className="border-border" />
                  <DetailRow label="Created">
                    <span className="text-[12.5px] text-text">{tc.created}</span>
                  </DetailRow>
                  <DetailRow label="Updated">
                    <span className="text-[12.5px] text-text">{tc.updatedFull}</span>
                  </DetailRow>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {showCopyTo && (
        <CopyToModal
          projectId={projectId}
          tc={tc}
          busy={copying}
          onClose={() => setShowCopyTo(false)}
          onCopy={async suiteId => {
            setCopying(true);
            try {
              await onDuplicate(suiteId);
            } finally {
              setCopying(false);
              setShowCopyTo(false);
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Copy to another feature ───────────────────────────────────

interface ApiSuiteNode {
  id: string;
  name: string;
  children: ApiSuiteNode[];
}
interface ApiModuleNode {
  id: string;
  name: string;
  suites: ApiSuiteNode[];
}
interface ApiPortalNode {
  id: string;
  name: string;
  modules: ApiModuleNode[];
}

function flattenSuites(suites: ApiSuiteNode[], prefix = ''): { id: string; label: string }[] {
  return suites.flatMap(s => [
    { id: s.id, label: prefix + s.name },
    ...flattenSuites(s.children, `${prefix}${s.name} / `),
  ]);
}

function CopyToModal({
  projectId,
  tc,
  busy,
  onClose,
  onCopy,
}: {
  projectId: string | null;
  tc: TestCase;
  busy: boolean;
  onClose: () => void;
  onCopy: (suiteId: string) => void;
}) {
  const [tree, setTree] = useState<ApiPortalNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [portalId, setPortalId] = useState(tc.portalId ?? '');
  const [moduleId, setModuleId] = useState(tc.moduleId ?? '');
  const [suiteId, setSuiteId] = useState(tc.suiteId ?? '');

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const data = await api.get<ApiPortalNode[]>(`/api/portals?projectId=${projectId}`);
        setTree(data);
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const portal = tree.find(p => p.id === portalId);
  const modules = portal?.modules ?? [];
  const mod = modules.find(m => m.id === moduleId);
  const suites = mod ? flattenSuites(mod.suites) : [];

  const selectCls =
    'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-[420px] rounded-xl border border-border bg-surface p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-text">Copy test case</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <i className="ti ti-x text-[15px]" />
          </button>
        </div>

        {loading ? (
          <p className="text-[13px] text-text-3">Loading…</p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-text-3">Portal</span>
              <select
                value={portalId}
                onChange={e => {
                  setPortalId(e.target.value);
                  setModuleId('');
                  setSuiteId('');
                }}
                className={selectCls}
              >
                <option value="">Select a portal…</option>
                {tree.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-text-3">Module</span>
              <select
                value={moduleId}
                disabled={!portal}
                onChange={e => {
                  setModuleId(e.target.value);
                  setSuiteId('');
                }}
                className={selectCls}
              >
                <option value="">Select a module…</option>
                {modules.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-text-3">Feature</span>
              <select
                value={suiteId}
                disabled={!mod}
                onChange={e => setSuiteId(e.target.value)}
                className={selectCls}
              >
                <option value="">Select a feature…</option>
                {suites.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-text-3">
              The copy is created in the selected feature — pick any feature in the workspace, or
              leave this as-is to copy it right next to the original.
            </p>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => suiteId && onCopy(suiteId)}
            disabled={busy || !suiteId}
            className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3.5">
      <p className="mb-2.5 text-[13px] font-semibold text-text">{title}</p>
      {children}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-text-3">{label}</span>
      {children}
    </div>
  );
}
