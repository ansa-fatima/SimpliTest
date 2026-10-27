'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

// "Improve with AI" for ONE existing case: the user says what should change, the
// AI returns a revised case, and only the fields that really differ are shown --
// each with a checkbox. Nothing is written until the user applies, and the
// change can be undone straight afterwards.

type Field =
  | 'title'
  | 'desc'
  | 'preconditions'
  | 'steps'
  | 'expected'
  | 'priority'
  | 'severity'
  | 'type'
  | 'labels';

interface Snapshot {
  title: string;
  desc: string;
  preconditions: string;
  steps: string[];
  expected: string;
  priority: string;
  severity: string;
  type: string;
  labels: string[];
}

interface Suggestion {
  caseId: string;
  current: Snapshot;
  proposed: Snapshot;
  changedFields: Field[];
  summary: string;
  unchanged: boolean;
  baseUpdatedAt: string;
}

interface ApplyResult {
  applied: Field[];
  undo: { updated: { id: string; before: Record<string, unknown> }[] };
}

export interface AiImprovePanelProps {
  /** The case's database id. */
  caseId: string;
  /** e.g. "TC-0042". */
  code: string;
  title: string;
  onClose: () => void;
  /** Called after an apply or an undo so the open case can refresh. */
  onChanged: () => void;
}

const PRESETS = [
  'Add negative and edge-case steps',
  'Make the steps clearer and more specific',
  'Fix wording, grammar and typos',
  'Rewrite the steps as Given / When / Then',
  'Shorten it without losing any check',
];

const FIELD_LABEL: Record<Field, string> = {
  title: 'Title',
  desc: 'Description',
  preconditions: 'Preconditions',
  steps: 'Steps',
  expected: 'Expected result',
  priority: 'Priority',
  severity: 'Severity',
  type: 'Type',
  labels: 'Labels',
};

const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-2';

export function AiImprovePanel({ caseId, code, title, onClose, onChanged }: AiImprovePanelProps) {
  const [stage, setStage] = useState<'form' | 'loading' | 'review' | 'saving' | 'done'>('form');
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState('');
  const [sugg, setSugg] = useState<Suggestion | null>(null);
  const [picked, setPicked] = useState<Field[]>([]);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);

  const working = stage === 'loading' || stage === 'saving';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !working) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, working]);

  const suggest = async () => {
    const text = instruction.trim();
    if (text.length < 5) {
      setError('Tell the AI what to change (a few words at least).');
      return;
    }
    setError('');
    setStage('loading');
    try {
      const s = await api.post<Suggestion>('/api/test-cases/ai-update', {
        caseId,
        instruction: text,
      });
      setSugg(s);
      setPicked(s.changedFields);
      setStage('review');
    } catch (e) {
      setError((e as Error).message);
      setStage('form');
    }
  };

  const apply = async () => {
    if (!sugg || picked.length === 0) return;
    setError('');
    setStage('saving');
    try {
      const r = await api.post<ApplyResult>('/api/test-cases/ai-update/apply', {
        caseId,
        fields: picked,
        proposed: sugg.proposed,
        baseUpdatedAt: sugg.baseUpdatedAt,
      });
      setResult(r);
      setStage('done');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      setStage('review');
    }
  };

  const undo = async () => {
    if (!result) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/test-cases/ai-generate/undo', result.undo);
      setUndone(true);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (f: Field) => setPicked(p => (p.includes(f) ? p.filter(x => x !== f) : [...p, f]));

  const changed = useMemo(() => sugg?.changedFields ?? [], [sugg]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={onClose}>
      <div
        className="flex h-full w-full max-w-[880px] flex-col overflow-hidden border-l border-border bg-surface shadow-2xl"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-2.5 py-1 text-[11px] font-semibold text-primary-text">
              <SparkIcon /> AI
            </span>
            <h2 className="mt-2 text-[17px] font-semibold text-text">Improve with AI</h2>
            <p className="truncate text-[12.5px] text-text-2">
              <span className="font-mono text-text-3">{code}</span>{' '}
              <span className="font-medium text-text">{title}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="flex-shrink-0 rounded-md p-1.5 text-text-3 hover:bg-surface-2 hover:text-text disabled:opacity-40"
            aria-label="Close"
          >
            <i className="ti ti-x text-[16px]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
              {error}
            </div>
          )}

          {(stage === 'form' || stage === 'loading') && (
            <div className="flex flex-col gap-4">
              <div>
                <label className={labelCls} htmlFor="ai-improve-instruction">
                  What should change?
                </label>
                <textarea
                  id="ai-improve-instruction"
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  disabled={stage === 'loading'}
                  rows={5}
                  maxLength={2000}
                  placeholder="e.g. Login now needs an OTP step after the password. Update the steps and expected result."
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:opacity-60"
                />
              </div>
              <div>
                <span className={labelCls}>Quick ideas</span>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map(p => (
                    <button
                      key={p}
                      type="button"
                      disabled={stage === 'loading'}
                      onClick={() => setInstruction(p)}
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[12px] text-text-2 hover:bg-surface-2 hover:text-text disabled:opacity-50"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[12px] text-text-3">
                The AI changes only what you ask for and keeps everything else as it is. You review
                every change before anything is saved.
              </p>
              {stage === 'loading' && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-3 text-[13px] text-text-2">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Revising the test case…
                </div>
              )}
            </div>
          )}

          {(stage === 'review' || stage === 'saving') && sugg && (
            <div className="flex flex-col gap-3">
              {sugg.unchanged ? (
                <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
                  <p className="text-[13px] font-semibold text-text">Nothing to change</p>
                  <p className="mt-0.5 text-[12.5px] text-text-2">
                    {sugg.summary ||
                      'The AI found nothing in this case that the instruction affects.'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-primary/20 bg-primary-light px-4 py-3">
                    <p className="text-[13px] text-primary-text">
                      {sugg.summary || 'The AI suggests the changes below.'}
                    </p>
                  </div>
                  <p className="text-[12px] text-text-3">
                    Only fields that changed are listed. Untick any change you don&apos;t want.
                  </p>
                  {changed.map(f => (
                    <FieldDiff
                      key={f}
                      field={f}
                      current={sugg.current}
                      proposed={sugg.proposed}
                      checked={picked.includes(f)}
                      disabled={stage === 'saving'}
                      onToggle={() => toggle(f)}
                    />
                  ))}
                </>
              )}
            </div>
          )}

          {stage === 'done' && result && (
            <div className="flex flex-col gap-3">
              <div
                className={cn(
                  'flex items-start gap-3 rounded-lg border px-4 py-3',
                  undone
                    ? 'border-border bg-surface-2'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800',
                )}
              >
                <i
                  className={cn(
                    'ti text-[20px]',
                    undone ? 'ti-arrow-back-up text-text-3' : 'ti-circle-check text-emerald-600',
                  )}
                />
                <div>
                  <p className="text-[13px] font-semibold">
                    {undone ? 'Undone — the test case is back as it was.' : 'Test case updated'}
                  </p>
                  {!undone && (
                    <p className="text-[12.5px]">
                      Changed: {result.applied.map(f => FIELD_LABEL[f].toLowerCase()).join(', ')}
                    </p>
                  )}
                </div>
              </div>
              {!undone && (
                <p className="text-[12px] text-text-3">
                  Not what you wanted? Undo puts the changed fields back exactly as they were.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3 sm:px-6">
          {stage === 'form' || stage === 'loading' ? (
            <>
              <span className="text-[12px] text-text-3">Powered by AI · review before saving</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={stage === 'loading'}
                  className="rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={suggest}
                  disabled={stage === 'loading'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  <SparkIcon /> {stage === 'loading' ? 'Working…' : 'Suggest changes'}
                </button>
              </div>
            </>
          ) : stage === 'done' ? (
            <>
              <span />
              <div className="flex gap-2">
                {!undone && (
                  <button
                    type="button"
                    onClick={undo}
                    disabled={busy}
                    className="rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
                  >
                    {busy ? 'Undoing…' : 'Undo'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-[12.5px] text-text-2">
                {sugg?.unchanged ? '' : `${picked.length} of ${changed.length} changes selected`}
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setStage('form')}
                  disabled={stage === 'saving'}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
                >
                  Try a different instruction
                </button>
                {!sugg?.unchanged && (
                  <button
                    type="button"
                    onClick={apply}
                    disabled={stage === 'saving' || picked.length === 0}
                    className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {stage === 'saving'
                      ? 'Applying…'
                      : `Apply ${picked.length} change${picked.length === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── One changed field: current vs suggested, side by side (stacked on phones) ──

function FieldDiff({
  field,
  current,
  proposed,
  checked,
  disabled,
  onToggle,
}: {
  field: Field;
  current: Snapshot;
  proposed: Snapshot;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-surface',
        checked ? 'border-primary/40' : 'border-border opacity-70',
      )}
    >
      <label className="flex cursor-pointer items-center gap-2.5 border-b border-border bg-surface-2 px-3 py-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          className="h-4 w-4 accent-[var(--primary,#2563eb)]"
        />
        <span className="text-[13px] font-semibold text-text">{FIELD_LABEL[field]}</span>
      </label>
      <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
        <Side heading="Current" tone="old">
          <FieldValue field={field} snap={current} other={proposed} tone="old" />
        </Side>
        <Side heading="Suggested" tone="new">
          <FieldValue field={field} snap={proposed} other={current} tone="new" />
        </Side>
      </div>
    </div>
  );
}

function Side({
  heading,
  tone,
  children,
}: {
  heading: string;
  tone: 'old' | 'new';
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2.5">
      <p
        className={cn(
          'mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide',
          tone === 'old' ? 'text-text-3' : 'text-emerald-700',
        )}
      >
        {heading}
      </p>
      {children}
    </div>
  );
}

function FieldValue({
  field,
  snap,
  other,
  tone,
}: {
  field: Field;
  snap: Snapshot;
  other: Snapshot;
  tone: 'old' | 'new';
}) {
  const mark =
    tone === 'old'
      ? 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300'
      : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300';

  if (field === 'steps') {
    const otherSet = new Set(other.steps.map(s => s.trim()));
    if (snap.steps.length === 0) return <p className="text-[13px] text-text-3">—</p>;
    return (
      <ol className="flex flex-col gap-1">
        {snap.steps.map((s, i) => (
          <li
            key={i}
            className={cn(
              'flex gap-2 rounded px-1.5 py-1 text-[13px] leading-snug',
              otherSet.has(s.trim()) ? 'text-text' : mark,
            )}
          >
            <span className="w-4 flex-shrink-0 text-right text-text-3">{i + 1}.</span>
            <span className="min-w-0 break-words">{s}</span>
          </li>
        ))}
      </ol>
    );
  }

  if (field === 'labels') {
    const otherSet = new Set(other.labels);
    if (snap.labels.length === 0) return <p className="text-[13px] text-text-3">—</p>;
    return (
      <div className="flex flex-wrap gap-1.5">
        {snap.labels.map(l => (
          <span
            key={l}
            className={cn(
              'rounded-full px-2 py-0.5 text-[12px]',
              otherSet.has(l) ? 'bg-surface-2 text-text-2' : mark,
            )}
          >
            {l}
          </span>
        ))}
      </div>
    );
  }

  const value = snap[field] as string;
  if (!value) return <p className="text-[13px] text-text-3">—</p>;
  return (
    <p className={cn('whitespace-pre-wrap break-words rounded px-1.5 py-1 text-[13px]', mark)}>
      {value}
    </p>
  );
}

function SparkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M12 2L14.5 9.5 22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
    </svg>
  );
}
