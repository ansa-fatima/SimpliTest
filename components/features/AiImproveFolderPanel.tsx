'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';
import { caseCode } from '@/components/features/tc-helpers';
import { MAX_REFERENCE_CHARS } from '@/lib/aiLimits';
import { joinReferenceText, readReferenceFile, type ReferenceFile } from '@/lib/referenceFile';
import {
  FIELD_LABEL,
  FieldDiff,
  PRESETS,
  hasPreset,
  togglePreset,
  SparkIcon,
  labelCls,
  type Field,
  type Suggestion,
} from '@/components/features/AiImprovePanel';

// "Improve all with AI" for a whole folder: every case under the selected portal /
// module / suite is revised with the same instruction and (optionally) a reference
// document -- a requirement or spec in almost any format. Each suggestion is shown
// for review; only what the user keeps is written, and the whole batch can be undone.

const MAX_CASES = 300;
const CONCURRENCY = 3;
const MAX_ATTACHMENTS = 4;
const PRESETS_FOLDER = [
  ...PRESETS,
  'Align every case with the attached document',
  'Add the missing negative and edge-case checks from the document',
];

type ItemStatus = 'queued' | 'working' | 'ready' | 'nochange' | 'failed';

interface Item {
  id: string;
  caseNum: number;
  title: string;
  status: ItemStatus;
  sugg?: Suggestion;
  error?: string;
  /** Fields the user will apply for this case (starts as every changed field). */
  picked: Field[];
  include: boolean;
}

interface ApplyResult {
  applied: Field[];
  undo: { updated: { id: string; before: Record<string, unknown> }[] };
}

export interface AiImproveFolderPanelProps {
  projectId: string;
  parentType: 'portal' | 'module' | 'suite';
  parentId: string;
  /** Improve exactly these cases (the list's selection) instead of the whole folder. */
  cases?: { id: string; caseNum: number; title: string }[];
  /** "Portal › Module › Suite", for the heading. */
  parentPath: string;
  onClose: () => void;
  onChanged: () => void;
}

type Stage = 'form' | 'running' | 'review' | 'applying' | 'done';

export function AiImproveFolderPanel({
  parentType,
  parentId,
  cases: given,
  parentPath,
  onClose,
  onChanged,
}: AiImproveFolderPanelProps) {
  const [stage, setStage] = useState<Stage>('form');
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');
  const [files, setFiles] = useState<ReferenceFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [totalCases, setTotalCases] = useState(0);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ cases: number; fields: number; failed: number } | null>(
    null,
  );
  const [undo, setUndo] = useState<ApplyResult['undo']['updated']>([]);
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef(false);

  const working = stage === 'running' || stage === 'applying';

  // Every case under this folder (sub-folders included), oldest first.
  useEffect(() => {
    if (given) {
      setTotalCases(given.length);
      setItems(
        given.slice(0, MAX_CASES).map(c => ({
          id: c.id,
          caseNum: c.caseNum,
          title: c.title,
          status: 'queued',
          picked: [],
          include: true,
        })),
      );
      setLoadingCases(false);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      page: '1',
      pageSize: '1000',
      sort: 'caseNum',
      order: 'asc',
    });
    params.set(
      parentType === 'suite' ? 'suiteId' : parentType === 'module' ? 'moduleId' : 'portalId',
      parentId,
    );
    api
      .get<{ items: { id: string; caseNum: number; title: string }[]; total: number }>(
        `/api/test-cases?${params.toString()}`,
      )
      .then(d => {
        if (cancelled) return;
        setTotalCases(d.total);
        setItems(
          d.items.slice(0, MAX_CASES).map(c => ({
            id: c.id,
            caseNum: c.caseNum,
            title: c.title,
            status: 'queued',
            picked: [],
            include: true,
          })),
        );
      })
      .catch(e => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoadingCases(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentType, parentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !working) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, working]);

  const referenceText = useMemo(
    () =>
      joinReferenceText(
        files.filter((f): f is Extract<ReferenceFile, { kind: 'text' }> => f.kind === 'text'),
      ),
    [files],
  );
  const attachments = files.filter(
    (f): f is Extract<ReferenceFile, { kind: 'attach' }> => f.kind === 'attach',
  );
  const tooLong = referenceText.length > MAX_REFERENCE_CHARS;
  const hasDoc = referenceText.length > 0 || attachments.length > 0;

  const addFiles = async (list: FileList | File[]) => {
    setFileError('');
    const problems: string[] = [];
    const added: ReferenceFile[] = [];
    for (const file of Array.from(list)) {
      try {
        added.push(await readReferenceFile(file));
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    setFiles(prev => {
      const next = [...prev];
      for (const f of added) {
        if (
          f.kind === 'attach' &&
          next.filter(x => x.kind === 'attach').length >= MAX_ATTACHMENTS
        ) {
          problems.push(`Attach at most ${MAX_ATTACHMENTS} PDFs / images.`);
          continue;
        }
        next.push(f);
      }
      return next;
    });
    if (problems.length) setFileError(problems.join(' '));
  };

  const patchItem = (id: string, patch: Partial<Item>) =>
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));

  // Revises every case, a few at a time. Stops early if the AI itself is unusable
  // (not set up, out of credit): the same error would repeat for every case.
  const run = async () => {
    const text = instruction.trim();
    if (!hasDoc && text.length < 5) {
      setError('Tell the AI what to change (a few words at least), or add a reference document.');
      return;
    }
    if (tooLong) {
      setError(
        `The documents are over ${MAX_REFERENCE_CHARS.toLocaleString()} characters. Use a shorter document, or one section at a time.`,
      );
      return;
    }
    if (items.length === 0) return;
    setError('');
    stopRef.current = false;
    setItems(prev =>
      prev.map(i => ({
        ...i,
        status: 'queued',
        sugg: undefined,
        error: undefined,
        picked: [],
        include: true,
      })),
    );
    setStage('running');

    const queue = items.map(i => i.id);
    let consecutiveFails = 0;
    let fatal = '';
    const worker = async () => {
      while (!stopRef.current && queue.length > 0) {
        const id = queue.shift()!;
        patchItem(id, { status: 'working' });
        try {
          const s = await api.post<Suggestion>('/api/test-cases/ai-update', {
            caseId: id,
            instruction: text,
            ...(referenceText ? { reference: referenceText } : {}),
            ...(attachments.length
              ? {
                  attachments: attachments.map(a => ({
                    name: a.name,
                    mediaType: a.mediaType,
                    data: a.data,
                  })),
                }
              : {}),
          });
          consecutiveFails = 0;
          patchItem(id, {
            status: s.unchanged ? 'nochange' : 'ready',
            sugg: s,
            picked: s.changedFields,
          });
        } catch (e) {
          const msg = (e as Error).message;
          consecutiveFails++;
          patchItem(id, { status: 'failed', error: msg });
          if (consecutiveFails >= 3 && !fatal) {
            fatal = msg;
            stopRef.current = true;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    // Anything not reached (stopped / fatal) goes back to "queued" -> shown as skipped.
    if (fatal) setError(`Stopped: ${fatal}`);
    setStage('review');
  };

  const ready = items.filter(i => i.status === 'ready');
  const chosen = ready.filter(i => i.include && i.picked.length > 0);
  const chosenFields = chosen.reduce((n, i) => n + i.picked.length, 0);
  const done = items.filter(i => i.status !== 'queued' && i.status !== 'working').length;
  const failed = items.filter(i => i.status === 'failed').length;
  const unchanged = items.filter(i => i.status === 'nochange').length;
  const skipped = items.filter(i => i.status === 'queued').length;

  const apply = async () => {
    setStage('applying');
    setError('');
    const updates: ApplyResult['undo']['updated'] = [];
    let fields = 0;
    let fails = 0;
    let firstFail = '';
    for (const it of chosen) {
      try {
        const r = await api.post<ApplyResult>('/api/test-cases/ai-update/apply', {
          caseId: it.id,
          fields: it.picked,
          proposed: it.sugg!.proposed,
          baseUpdatedAt: it.sugg!.baseUpdatedAt,
        });
        updates.push(...r.undo.updated);
        fields += r.applied.length;
      } catch (e) {
        fails++;
        if (!firstFail) firstFail = (e as Error).message;
        patchItem(it.id, { error: (e as Error).message });
      }
    }
    setUndo(updates);
    setApplied({ cases: updates.length, fields, failed: fails });
    if (firstFail) setError(`${fails} case${fails === 1 ? '' : 's'} not saved: ${firstFail}`);
    setStage('done');
    if (updates.length > 0) onChanged();
  };

  const undoAll = async () => {
    setBusy(true);
    setError('');
    try {
      // The undo endpoint takes up to 100 cases per call.
      for (let i = 0; i < undo.length; i += 100)
        await api.post('/api/test-cases/ai-generate/undo', { updated: undo.slice(i, i + 100) });
      setUndone(true);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleField = (id: string, f: Field) =>
    setItems(prev =>
      prev.map(i =>
        i.id === id
          ? {
              ...i,
              picked: i.picked.includes(f) ? i.picked.filter(x => x !== f) : [...i.picked, f],
            }
          : i,
      ),
    );

  const visible = items.filter(i =>
    showUnchanged ? true : i.status === 'ready' || i.status === 'failed',
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onMouseDown={() => !working && onClose()}
    >
      <div
        className="flex h-full w-full max-w-[920px] flex-col overflow-hidden border-l border-border bg-surface shadow-2xl"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-2.5 py-1 text-[11px] font-semibold text-primary-text">
              <SparkIcon /> AI
            </span>
            <h2 className="mt-2 text-[17px] font-semibold text-text">
              {given ? 'Improve selected test cases' : 'Improve all test cases'}
            </h2>
            <p className="truncate text-[12.5px] text-text-2">
              <span className="font-medium text-text">{parentPath || 'Folder'}</span>
              {' · '}
              {loadingCases
                ? 'counting…'
                : `${totalCases.toLocaleString()} test case${totalCases === 1 ? '' : 's'}`}
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

          {stage === 'form' && (
            <div className="flex flex-col gap-4">
              {!loadingCases && items.length === 0 && !error && (
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-3 text-[13px] text-text-2">
                  There are no test cases in this folder yet.
                </div>
              )}
              {totalCases > MAX_CASES && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  This folder has {totalCases.toLocaleString()} cases. The first {MAX_CASES} are
                  improved in one run; open a smaller folder to do the rest.
                </div>
              )}
              <div>
                <label className={labelCls} htmlFor="ai-folder-instruction">
                  What should change?{' '}
                  {hasDoc && (
                    <span className="normal-case text-text-3">
                      (optional — the document is the brief)
                    </span>
                  )}
                </label>
                <textarea
                  id="ai-folder-instruction"
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="e.g. Add negative and edge-case steps, and make every step a short imperative action."
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRESETS_FOLDER.map(p => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={hasPreset(instruction, p)}
                      onClick={() => setInstruction(togglePreset(instruction, p))}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-left text-[12px]',
                        hasPreset(instruction, p)
                          ? 'border-primary bg-primary-light font-medium text-primary-text'
                          : 'border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text',
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className={labelCls}>Reference document (optional)</span>
                <label
                  onDragOver={e => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOver(false);
                    void addFiles(e.dataTransfer.files);
                  }}
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-5 text-center text-[12.5px] text-text-2',
                    dragOver
                      ? 'border-primary bg-primary-light'
                      : 'border-border bg-surface-2 hover:bg-surface',
                  )}
                >
                  <i className="ti ti-file-upload text-[22px] text-text-3" />
                  <span>
                    <b className="text-text">Drop a requirement or spec here</b>, or click to choose
                  </span>
                  <span className="text-[11.5px] text-text-3">
                    Any file: .md, .txt, .docx, .pptx, .xlsx, .csv, .json, .html, PDF, images … The
                    AI uses it to fix and complete every case.
                  </span>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={e => {
                      if (e.target.files) void addFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
                {fileError && <p className="mt-1.5 text-[12px] text-red-600">{fileError}</p>}
                {files.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {files.map((f, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px]"
                      >
                        <i
                          className={cn(
                            'ti text-text-3',
                            f.kind === 'attach' ? 'ti-paperclip' : 'ti-file-text',
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-text">{f.name}</span>
                        <span className="text-[11px] text-text-3">
                          {f.kind === 'text'
                            ? `${f.text.length.toLocaleString()} characters`
                            : `${Math.max(1, Math.round(f.size / 1024)).toLocaleString()} KB · read by the AI`}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${f.name}`}
                          onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                          className="rounded p-0.5 text-text-3 hover:bg-surface-2 hover:text-text"
                        >
                          <i className="ti ti-x text-[13px]" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {tooLong && (
                  <p className="mt-1.5 text-[12px] font-medium text-red-600">
                    {referenceText.length.toLocaleString()} / {MAX_REFERENCE_CHARS.toLocaleString()}{' '}
                    characters — too long. Remove a file or use a shorter document.
                  </p>
                )}
              </div>

              <p className="text-[12px] text-text-3">
                The AI revises each case one at a time and keeps what you didn&apos;t ask to change.
                It uses one AI request per case ({items.length.toLocaleString()} here), and nothing
                is saved until you review and apply — then the whole batch can be undone.
              </p>
            </div>
          )}

          {(stage === 'running' || stage === 'review' || stage === 'applying') && (
            <div className="flex flex-col gap-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-[12.5px] text-text-2">
                  <span>
                    {stage === 'running'
                      ? `Improving… ${done} of ${items.length}`
                      : `${ready.length} improved · ${unchanged} no change${failed ? ` · ${failed} failed` : ''}${skipped ? ` · ${skipped} not run` : ''}`}
                  </span>
                  {stage !== 'running' && unchanged > 0 && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-3">
                      <input
                        type="checkbox"
                        checked={showUnchanged}
                        onChange={e => setShowUnchanged(e.target.checked)}
                      />
                      Show cases with no change
                    </label>
                  )}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {visible.length === 0 && stage !== 'running' && (
                <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-[13px] text-text-2">
                  The AI found nothing to change in these cases.
                </div>
              )}

              {visible.map(it => (
                <div
                  key={it.id}
                  className={cn(
                    'overflow-hidden rounded-lg border bg-surface',
                    it.status === 'ready' && it.include ? 'border-primary/40' : 'border-border',
                  )}
                >
                  <div className="flex items-start gap-2.5 px-3 py-2.5">
                    {it.status === 'ready' ? (
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={it.include}
                        disabled={stage !== 'review'}
                        onChange={e => patchItem(it.id, { include: e.target.checked })}
                        aria-label={`Apply changes to ${caseCode(it.caseNum)}`}
                      />
                    ) : (
                      <span className="mt-1 h-4 w-4" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-text">
                        <span className="mr-1.5 font-mono text-[11.5px] text-text-3">
                          {caseCode(it.caseNum)}
                        </span>
                        {it.title}
                      </p>
                      {it.status === 'ready' && (
                        <p className="mt-0.5 text-[12.5px] text-text-2">
                          {it.sugg?.summary}
                          <span className="ml-1.5 text-text-3">
                            ·{' '}
                            {it.sugg?.changedFields
                              .map(f => FIELD_LABEL[f].toLowerCase())
                              .join(', ')}
                          </span>
                        </p>
                      )}
                      {it.status === 'nochange' && (
                        <p className="mt-0.5 text-[12.5px] text-text-3">
                          {it.sugg?.summary || 'No change needed'}
                        </p>
                      )}
                      {it.status === 'failed' && (
                        <p className="mt-0.5 text-[12.5px] text-red-600">{it.error}</p>
                      )}
                      {it.status === 'queued' && stage !== 'running' && (
                        <p className="mt-0.5 text-[12.5px] text-text-3">Not run</p>
                      )}
                    </div>
                    {it.status === 'working' && (
                      <span className="mt-1 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    )}
                    {it.status === 'ready' && (
                      <button
                        type="button"
                        onClick={() => setOpen(open === it.id ? null : it.id)}
                        className="flex-shrink-0 rounded-md border border-border px-2.5 py-1 text-[12px] text-text-2 hover:bg-surface-2"
                      >
                        {open === it.id ? 'Hide changes' : 'Review changes'}
                      </button>
                    )}
                  </div>
                  {open === it.id && it.sugg && (
                    <div className="flex flex-col gap-2 border-t border-border bg-surface-2/40 px-3 py-3">
                      {it.sugg.changedFields.map(f => (
                        <FieldDiff
                          key={f}
                          field={f}
                          current={it.sugg!.current}
                          proposed={it.sugg!.proposed}
                          checked={it.picked.includes(f)}
                          disabled={stage !== 'review'}
                          onToggle={() => toggleField(it.id, f)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {stage === 'done' && applied && (
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
                    {undone
                      ? 'Undone — every test case is back as it was.'
                      : `${applied.cases} test case${applied.cases === 1 ? '' : 's'} updated`}
                  </p>
                  {!undone && (
                    <p className="text-[12.5px]">
                      {applied.fields} change{applied.fields === 1 ? '' : 's'} saved
                      {applied.failed ? ` · ${applied.failed} could not be saved` : ''}
                    </p>
                  )}
                </div>
              </div>
              {!undone && applied.cases > 0 && (
                <p className="text-[12px] text-text-3">
                  Not what you wanted? Undo puts every changed field back exactly as it was.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3 sm:px-6">
          {stage === 'form' ? (
            <>
              <span className="text-[12px] text-text-3">Powered by AI · review before saving</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-medium text-text hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={run}
                  disabled={loadingCases || items.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  <SparkIcon /> Improve {items.length.toLocaleString()} test case
                  {items.length === 1 ? '' : 's'}
                </button>
              </div>
            </>
          ) : stage === 'running' ? (
            <>
              <span className="text-[12px] text-text-3">
                You can stop at any time; nothing is saved yet.
              </span>
              <button
                type="button"
                onClick={() => (stopRef.current = true)}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-medium text-text hover:bg-surface-2"
              >
                Stop
              </button>
            </>
          ) : stage === 'done' ? (
            <>
              <span />
              <div className="flex gap-2">
                {!undone && undo.length > 0 && (
                  <button
                    type="button"
                    onClick={undoAll}
                    disabled={busy}
                    className="rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
                  >
                    {busy ? 'Undoing…' : 'Undo all'}
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
                {stage === 'applying'
                  ? 'Saving…'
                  : `${chosen.length} case${chosen.length === 1 ? '' : 's'} · ${chosenFields} change${chosenFields === 1 ? '' : 's'} selected`}
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStage('form');
                    setError('');
                  }}
                  disabled={stage === 'applying'}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
                >
                  Start over
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={stage === 'applying' || chosen.length === 0}
                  className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {stage === 'applying'
                    ? 'Applying…'
                    : `Apply to ${chosen.length} test case${chosen.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
