'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';
import { useJiraSiteUrl } from '@/lib/jiraLink';

// "Generate with AI": requirement in -> proposed test cases out -> the user
// decides, case by case, what happens (create / update the matching existing
// case / replace it / skip) -> one save. Nothing is written until the user
// confirms, and the whole batch can be undone afterwards.

type ParentType = 'portal' | 'module' | 'suite';
type Depth = 'happy' | 'edge' | 'negative';
type StepStyle = 'actions' | 'gwt';
type Action = 'create' | 'skip' | 'update' | 'replace';
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

interface ExistingMatch {
  id: string;
  caseNum: number;
  title: string;
  desc: string;
  preconditions: string;
  steps: string[];
  expected: string;
  priority: string;
  severity: string;
  type: string;
  similarity: number;
}

interface Proposal {
  title: string;
  desc: string;
  preconditions: string;
  steps: string[];
  expected: string;
  priority: string;
  severity: string;
  type: string;
  labels: string[];
  verdict: 'new' | 'duplicate';
  match: ExistingMatch | null;
  /** Who decided the verdict: the wording check or the AI double-check. */
  source?: 'wording' | 'ai';
}

interface Options {
  priority: string[];
  severity: string[];
  type: string[];
}

interface Row {
  id: number;
  c: Proposal;
  action: Action;
  /** Which fields an "update existing" should overwrite. */
  fields: Field[];
  open: boolean;
  diff: boolean;
  /** A single-row regenerate is in flight. */
  busy?: boolean;
}

interface SaveResult {
  created: number;
  updated: number;
  skipped: number;
  undo: {
    created: string[];
    updated: { id: string; before: Record<string, unknown> }[];
  };
}

export interface AiGeneratePanelProps {
  projectId: string;
  parentType: ParentType;
  parentId: string;
  /** "Portal › Module › Suite" -- shown so the user knows where cases will land. */
  parentPath: string;
  onClose: () => void;
  /** Called after a save or an undo so the list can refetch. */
  onChanged: () => void;
}

const DEPTHS: { v: Depth; label: string }[] = [
  { v: 'happy', label: 'Happy path only' },
  { v: 'edge', label: 'Plus edge cases' },
  { v: 'negative', label: 'Plus negative & permission cases' },
];
const COUNTS = [3, 5, 8, 10, 15, 20, 25];
const ATTACH_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const MAX_FILES = 4;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Fields worth ticking by default when updating: the ones the AI actually changes.
const DEFAULT_UPDATE_FIELDS: Field[] = ['desc', 'preconditions', 'steps', 'expected'];

const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-2';
const inputCls =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light';

export function AiGeneratePanel({
  projectId,
  parentType,
  parentId,
  parentPath,
  onClose,
  onChanged,
}: AiGeneratePanelProps) {
  const [stage, setStage] = useState<'form' | 'loading' | 'preview' | 'saving' | 'done'>('form');
  const [requirement, setRequirement] = useState('');
  const [count, setCount] = useState(8);
  const [depth, setDepth] = useState<Depth>('edge');
  const [style, setStyle] = useState<StepStyle>('actions');
  const [error, setError] = useState('');
  // Optional "start from a Jira ticket" helper (only when Jira is connected).
  const jiraSite = useJiraSiteUrl(projectId);
  const [ticket, setTicket] = useState('');
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketNote, setTicketNote] = useState('');
  const [ticketError, setTicketError] = useState('');
  // Attached PDFs / images go to the model; text files are read into the requirement box.
  const [files, setFiles] = useState<
    { name: string; mediaType: string; data: string; size: number }[]
  >([]);
  const [fileError, setFileError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const [options, setOptions] = useState<Options>({ priority: [], severity: [], type: [] });
  const [rows, setRows] = useState<Row[]>([]);
  const [existingCount, setExistingCount] = useState(0);
  const [aiCheck, setAiCheck] = useState<'off' | 'applied' | 'unavailable'>('off');
  const [result, setResult] = useState<SaveResult | null>(null);
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  // True while the AI is still writing cases into the preview.
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Closing the panel stops the request (and the AI) instead of letting it run on.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Close on Escape (not while a request is in flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stage !== 'loading' && stage !== 'saving') {
        abortRef.current?.abort();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, stage]);

  const toRows = (proposals: Proposal[], startId: number): Row[] =>
    proposals.map((c, i) => ({
      id: startId + i,
      c,
      // New cases are created by default; a near-duplicate is skipped until the
      // user decides -- the safe default, nothing gets silently doubled up.
      action: c.verdict === 'duplicate' ? 'skip' : 'create',
      fields: DEFAULT_UPDATE_FIELDS,
      open: false,
      diff: false,
    }));

  // Streams the proposals in: the preview opens as soon as the AI starts and each
  // test case is added the moment it is written. If the stream breaks part-way the
  // cases that already arrived are kept.
  const generate = async (append: boolean) => {
    setError('');
    if (requirement.trim().length < 15 && files.length === 0) {
      setError(
        'Describe the requirement in a bit more detail (at least a sentence), or attach a file.',
      );
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStage('loading');
    setStreaming(true);

    const batch: number[] = []; // row ids created by THIS run, in arrival order
    let nextId = rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    let gotAny = false;

    const handle = (name: string, data: unknown) => {
      if (name === 'meta') {
        const m = data as { options: Options; existingCount: number };
        setOptions(m.options);
        setExistingCount(m.existingCount);
        if (!append) setRows([]);
        setStage('preview');
      } else if (name === 'case') {
        gotAny = true;
        const id = nextId++;
        batch.push(id);
        setRows(prev => [...prev, ...toRows([data as Proposal], id)]);
      } else if (name === 'verdicts') {
        // The AI double-check ran after the last case: apply its corrections.
        const vs = data as {
          index: number;
          verdict: 'new' | 'duplicate';
          match: ExistingMatch | null;
          source: 'wording' | 'ai';
        }[];
        setRows(prev =>
          prev.map(r => {
            const v = vs.find(x => x.index === batch.indexOf(r.id));
            if (!v) return r;
            // Only move the default action if the user hasn't chosen something else.
            const wasDefault = r.action === (r.c.verdict === 'duplicate' ? 'skip' : 'create');
            return {
              ...r,
              c: { ...r.c, verdict: v.verdict, match: v.match, source: v.source },
              action: wasDefault ? (v.verdict === 'duplicate' ? 'skip' : 'create') : r.action,
            };
          }),
        );
      } else if (name === 'done') {
        setAiCheck((data as { aiCheck: 'off' | 'applied' | 'unavailable' }).aiCheck);
      } else if (name === 'error') {
        throw new Error((data as { message?: string }).message || 'Could not generate test cases.');
      }
    };

    try {
      const res = await fetch('/api/test-cases/ai-generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          parentType,
          parentId,
          requirement,
          count,
          depth,
          style,
          // "Add more": don't repeat what is already on screen.
          keepTitles: append ? rows.map(r => r.c.title) : undefined,
          attachments: attachmentsPayload(),
        }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || 'Could not generate test cases.');
      }
      setAiCheck('off');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const name = /^event: (.*)$/m.exec(block)?.[1];
          const raw = /^data: (.*)$/m.exec(block)?.[1];
          if (name && raw) handle(name, JSON.parse(raw));
        }
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError((e as Error).message || 'Could not generate test cases.');
      // Nothing arrived: back to where the user started. Otherwise keep the cases that did.
      if (!gotAny) setStage(append ? 'preview' : 'form');
    } finally {
      if (abortRef.current === ctrl) setStreaming(false);
    }
  };

  const readAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.onerror = () => reject(new Error('read failed'));
      r.readAsDataURL(file);
    });

  const addFiles = async (list: FileList | File[]) => {
    setFileError('');
    const problems: string[] = [];
    for (const file of Array.from(list)) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      try {
        if (['txt', 'md', 'csv', 'json'].includes(ext) || file.type.startsWith('text/')) {
          if (file.size > 200 * 1024) {
            problems.push(file.name + ' is too long for a text file (200 KB max).');
            continue;
          }
          const text = (await file.text()).trim();
          if (text) setRequirement(prev => (prev.trim() ? prev.trim() + '\n\n' : '') + text);
        } else if (ATTACH_TYPES.includes(file.type)) {
          if (file.size > MAX_FILE_BYTES) {
            problems.push(file.name + ' is too large (5 MB max).');
            continue;
          }
          const data = await readAsBase64(file);
          setFiles(prev => {
            if (prev.length >= MAX_FILES) {
              problems.push('Attach at most ' + MAX_FILES + ' files.');
              return prev;
            }
            return [...prev, { name: file.name, mediaType: file.type, data, size: file.size }];
          });
        } else {
          problems.push(file.name + ': only text, PDF and image files can be used.');
        }
      } catch {
        problems.push('Could not read ' + file.name + '.');
      }
    }
    if (problems.length > 0) setFileError(problems.join(' '));
  };

  const attachmentsPayload = () =>
    files.map(f => ({ name: f.name, mediaType: f.mediaType, data: f.data }));

  const fetchTicket = async () => {
    setTicketError('');
    setTicketNote('');
    if (!ticket.trim()) {
      setTicketError('Enter a ticket key or link, like NPD-11800.');
      return;
    }
    setTicketBusy(true);
    try {
      const r = await api.post<{ key: string; title: string; text: string }>(
        `/api/projects/${projectId}/integrations/jira/issue-text`,
        { ticketLink: ticket },
      );
      // Add to what is already there instead of wiping the user's own notes.
      setRequirement(prev => (prev.trim() ? prev.trim() + '\n\n' + r.text : r.text));
      setTicketNote(`Loaded ${r.key} — ${r.title}`);
      setTicket('');
    } catch (e) {
      setTicketError((e as Error).message || 'Could not load that ticket.');
    } finally {
      setTicketBusy(false);
    }
  };

  const patchRow = (id: number, patch: Partial<Row>) =>
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const patchCase = (id: number, patch: Partial<Proposal>) =>
    setRows(rs => rs.map(r => (r.id === id ? { ...r, c: { ...r.c, ...patch } } : r)));

  // Replace ONE proposal with a fresh one, without touching the others. The
  // model is told about every other title on screen so it writes something new.
  const regenerateRow = async (id: number) => {
    setError('');
    patchRow(id, { busy: true });
    try {
      const data = await api.post<{ cases: Proposal[] }>('/api/test-cases/ai-generate', {
        parentType,
        parentId,
        requirement,
        count: 1,
        depth,
        style,
        keepTitles: rows.map(r => r.c.title),
        attachments: attachmentsPayload(),
      });
      const fresh = data.cases[0];
      if (!fresh) throw new Error('No new case came back. Try again.');
      setRows(rs => rs.map(r => (r.id === id ? { ...toRows([fresh], id)[0], open: r.open } : r)));
    } catch (e) {
      setError((e as Error).message || 'Could not regenerate this case.');
      patchRow(id, { busy: false });
    }
  };

  const tally = useMemo(() => {
    const t = { create: 0, update: 0, replace: 0, skip: 0 };
    for (const r of rows) t[r.action]++;
    return t;
  }, [rows]);
  const dupCount = rows.filter(r => r.c.verdict === 'duplicate').length;
  const toSave = tally.create + tally.update + tally.replace;

  const save = async () => {
    setError('');
    setStage('saving');
    try {
      const decisions = rows.map(r => {
        if (r.action === 'skip') return { kind: 'skip' as const };
        if (r.action === 'create') return { kind: 'create' as const, case: payload(r.c) };
        if (r.action === 'replace' && r.c.match)
          return { kind: 'replace' as const, existingId: r.c.match.id, case: payload(r.c) };
        if (r.action === 'update' && r.c.match)
          return {
            kind: 'update' as const,
            existingId: r.c.match.id,
            case: payload(r.c),
            fields: r.fields,
          };
        return { kind: 'skip' as const };
      });
      const res = await api.post<SaveResult>('/api/test-cases/ai-generate/save', {
        parentType,
        parentId,
        decisions,
      });
      setResult(res);
      setStage('done');
      onChanged();
    } catch (e) {
      setError((e as Error).message || 'Could not save.');
      setStage('preview');
    }
  };

  const undo = async () => {
    if (!result) return;
    setBusy(true);
    try {
      await api.post('/api/test-cases/ai-generate/undo', result.undo);
      setUndone(true);
      onChanged();
    } catch (e) {
      setError((e as Error).message || 'Could not undo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={onClose}>
      <div
        className="flex h-full w-full max-w-[880px] flex-col overflow-hidden border-l border-border bg-surface shadow-2xl"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-2.5 py-1 text-[11px] font-semibold text-primary-text">
              <SparkIcon /> AI
            </span>
            <h2 className="mt-2 text-[17px] font-semibold text-text">Generate test cases</h2>
            <p className="truncate text-[12.5px] text-text-2">
              Adding to <span className="font-medium text-text">{parentPath}</span>
              {existingCount > 0 && stage !== 'form' && (
                <span className="text-text-3"> · {existingCount} existing cases compared</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={stage === 'loading' || stage === 'saving'}
            className="flex-shrink-0 rounded-md p-1.5 text-text-3 hover:bg-surface-2 hover:text-text disabled:opacity-40"
            aria-label="Close"
          >
            <i className="ti ti-x text-[16px]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
              {error}
            </div>
          )}

          {(stage === 'form' || stage === 'loading') && (
            <div className="flex flex-col gap-4">
              {jiraSite && (
                <div>
                  <label className={labelCls}>Start from a Jira ticket (optional)</label>
                  <div className="flex gap-2">
                    <input
                      value={ticket}
                      onChange={e => setTicket(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void fetchTicket();
                        }
                      }}
                      disabled={stage === 'loading' || ticketBusy}
                      placeholder="NPD-11800 or a ticket link"
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={() => void fetchTicket()}
                      disabled={stage === 'loading' || ticketBusy}
                      className="flex-shrink-0 rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
                    >
                      {ticketBusy ? 'Loading…' : 'Load ticket'}
                    </button>
                  </div>
                  {ticketError && <p className="mt-1 text-[12px] text-red-600">{ticketError}</p>}
                  {ticketNote && <p className="mt-1 text-[12px] text-emerald-700">{ticketNote}</p>}
                </div>
              )}
              <div>
                <label className={labelCls}>Requirement</label>
                <textarea
                  value={requirement}
                  onChange={e => setRequirement(e.target.value)}
                  disabled={stage === 'loading'}
                  rows={9}
                  placeholder={
                    'Paste the requirement, user story or acceptance criteria.\n\nExample: Users can sign in with email and password. After 5 failed attempts the account is locked for 15 minutes. A "Forgot password" link sends a reset email.'
                  }
                  className={cn(inputCls, 'resize-y leading-relaxed')}
                />
                <p className="mt-1 text-[11px] text-text-3">
                  {requirement.trim().length.toLocaleString()} / 8,000 characters
                </p>
              </div>
              <div>
                <label className={labelCls}>Attach files (optional)</label>
                <label
                  onDragOver={e => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOver(false);
                    if (stage !== 'loading') void addFiles(e.dataTransfer.files);
                  }}
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center text-[12.5px] text-text-2 hover:bg-surface-2',
                    dragOver ? 'border-primary bg-primary-light' : 'border-border',
                  )}
                >
                  <i className="ti ti-upload text-[18px] text-text-3" />
                  <span>
                    <b className="text-text">Choose files</b> or drop them here
                  </span>
                  <span className="text-[11px] text-text-3">
                    PDF or screenshots (PNG, JPG, WEBP) are read by the AI · .txt / .md go straight
                    into the box above · 5 MB each, up to {MAX_FILES}
                  </span>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.json"
                    className="hidden"
                    disabled={stage === 'loading'}
                    onChange={e => {
                      if (e.target.files) void addFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
                {fileError && <p className="mt-1 text-[12px] text-red-600">{fileError}</p>}
                {files.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {files.map((f, i) => (
                      <span
                        key={f.name + i}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-1 pl-2.5 pr-1.5 text-[12px] text-text-2"
                      >
                        <i
                          className={cn(
                            'ti text-[13px]',
                            f.mediaType === 'application/pdf' ? 'ti-file-type-pdf' : 'ti-photo',
                          )}
                        />
                        {f.name}
                        <button
                          type="button"
                          onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                          disabled={stage === 'loading'}
                          className="rounded-full p-0.5 text-text-3 hover:bg-surface-3 hover:text-text"
                          aria-label={'Remove ' + f.name}
                        >
                          <i className="ti ti-x text-[11px]" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className={labelCls}>How many</label>
                  <select
                    value={count}
                    onChange={e => setCount(Number(e.target.value))}
                    disabled={stage === 'loading'}
                    className={inputCls}
                  >
                    {COUNTS.map(n => (
                      <option key={n} value={n}>
                        {n} test cases
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Depth</label>
                  <select
                    value={depth}
                    onChange={e => setDepth(e.target.value as Depth)}
                    disabled={stage === 'loading'}
                    className={inputCls}
                  >
                    {DEPTHS.map(d => (
                      <option key={d.v} value={d.v}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Step style</label>
                  <select
                    value={style}
                    onChange={e => setStyle(e.target.value as StepStyle)}
                    disabled={stage === 'loading'}
                    className={inputCls}
                  >
                    <option value="actions">Short actions</option>
                    <option value="gwt">Given / When / Then</option>
                  </select>
                </div>
              </div>
              <p className="text-[12px] text-text-3">
                The AI proposes cases in your workspace&apos;s own format and priorities. Nothing is
                saved until you review them, and cases that look like ones you already have are
                flagged so you can choose what to do.
              </p>
              {stage === 'loading' && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-3 text-[13px] text-text-2">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Writing test cases and comparing with your existing ones…
                </div>
              )}
            </div>
          )}

          {(stage === 'preview' || stage === 'saving') && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-text-2">
                  {streaming && (
                    <span className="mr-2 inline-flex items-center gap-1.5 text-primary-text">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      Writing…
                    </span>
                  )}
                  <b className="text-text">{rows.length}</b> proposed ·{' '}
                  <span className="text-emerald-700">{rows.length - dupCount} new</span>
                  {dupCount > 0 && (
                    <>
                      {' '}
                      · <span className="text-amber-700">{dupCount} similar to existing</span>
                    </>
                  )}
                </p>
                {dupCount > 0 && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-border px-2.5 py-1 text-[12px] text-text-2 hover:bg-surface-2"
                      onClick={() =>
                        setRows(rs =>
                          rs.map(r => (r.c.verdict === 'duplicate' ? { ...r, action: 'skip' } : r)),
                        )
                      }
                    >
                      Skip all duplicates
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2.5 py-1 text-[12px] text-text-2 hover:bg-surface-2"
                      onClick={() =>
                        setRows(rs =>
                          rs.map(r =>
                            r.c.verdict === 'duplicate' ? { ...r, action: 'create' } : r,
                          ),
                        )
                      }
                    >
                      Create all as new
                    </button>
                  </div>
                )}
              </div>

              {aiCheck === 'unavailable' && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                  The AI double-check for duplicates wasn&apos;t available just now, so these
                  matches use the wording check only.
                </p>
              )}
              {rows.map(r => (
                <ProposalRow
                  key={r.id}
                  row={r}
                  options={options}
                  onRow={p => patchRow(r.id, p)}
                  onCase={p => patchCase(r.id, p)}
                  onRegenerate={() => regenerateRow(r.id)}
                  regenDisabled={streaming}
                />
              ))}
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
                    {undone ? 'Undone — nothing was changed.' : 'Saved'}
                  </p>
                  {!undone && (
                    <p className="text-[12.5px]">
                      {result.created} created · {result.updated} updated · {result.skipped} skipped
                    </p>
                  )}
                </div>
              </div>
              {!undone && (
                <p className="text-[12px] text-text-3">
                  Saved by mistake? Undo removes the new cases and puts the updated ones back as
                  they were.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-6 py-3">
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
                  onClick={() => generate(false)}
                  disabled={stage === 'loading'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  <SparkIcon /> {stage === 'loading' ? 'Generating…' : 'Generate'}
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
                Will create <b>{tally.create}</b>
                {tally.update + tally.replace > 0 && (
                  <>
                    , update <b>{tally.update + tally.replace}</b>
                  </>
                )}
                , skip <b>{tally.skip}</b>
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    abortRef.current?.abort();
                    setStreaming(false);
                    setStage('form');
                  }}
                  disabled={stage === 'saving'}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => generate(true)}
                  disabled={stage === 'saving' || streaming}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-text hover:bg-surface-2 disabled:opacity-50"
                >
                  Add more
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={stage === 'saving' || streaming || toSave === 0}
                  className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {stage === 'saving' ? 'Saving…' : `Save ${toSave} case${toSave === 1 ? '' : 's'}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function payload(c: Proposal) {
  return {
    title: c.title,
    desc: c.desc,
    preconditions: c.preconditions,
    steps: c.steps,
    expected: c.expected,
    priority: c.priority,
    severity: c.severity,
    type: c.type,
    labels: c.labels,
  };
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

// ─── One proposed case ─────────────────────────────────────────────────────

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

function ProposalRow({
  row,
  options,
  onRow,
  onCase,
  onRegenerate,
  regenDisabled,
}: {
  row: Row;
  options: Options;
  onRow: (p: Partial<Row>) => void;
  onCase: (p: Partial<Proposal>) => void;
  onRegenerate: () => void;
  regenDisabled?: boolean;
}) {
  const { c, action } = row;
  const dup = c.verdict === 'duplicate' && c.match;
  const skipped = action === 'skip';

  const actions: { v: Action; label: string }[] = dup
    ? [
        { v: 'skip', label: 'Skip' },
        { v: 'create', label: 'Create as new' },
        { v: 'update', label: 'Update existing' },
        { v: 'replace', label: 'Replace existing' },
      ]
    : [
        { v: 'create', label: 'Create' },
        { v: 'skip', label: 'Skip' },
      ];

  const stepsText = c.steps.join('\n');

  return (
    <div
      className={cn(
        'rounded-xl border bg-surface',
        dup ? 'border-amber-300' : 'border-border',
        skipped && !dup && 'opacity-60',
      )}
    >
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 flex-shrink-0 rounded-full',
              dup ? 'bg-amber-500' : 'bg-emerald-500',
            )}
            title={dup ? 'Similar to an existing case' : 'New'}
          />
          <input
            value={c.title}
            onChange={e => onCase({ title: e.target.value })}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13.5px] font-medium text-text outline-none hover:border-border focus:border-primary"
          />
          <button
            type="button"
            onClick={onRegenerate}
            disabled={row.busy || regenDisabled}
            className="flex-shrink-0 rounded p-1 text-text-3 hover:bg-surface-2 hover:text-text disabled:opacity-50"
            title="Replace this case with a different one"
          >
            {row.busy ? (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            ) : (
              <i className="ti ti-refresh text-[15px]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onRow({ open: !row.open })}
            className="flex-shrink-0 rounded p-1 text-text-3 hover:bg-surface-2 hover:text-text"
            title={row.open ? 'Hide details' : 'Show details'}
          >
            <i className={cn('ti text-[15px]', row.open ? 'ti-chevron-up' : 'ti-chevron-down')} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pl-4">
          <MiniSelect
            value={c.priority}
            list={options.priority}
            onChange={v => onCase({ priority: v })}
          />
          <MiniSelect
            value={c.severity}
            list={options.severity}
            onChange={v => onCase({ severity: v })}
          />
          <MiniSelect value={c.type} list={options.type} onChange={v => onCase({ type: v })} />
          <span className="text-[11px] text-text-3">{c.steps.length} steps</span>
          {c.source === 'ai' && (
            <span
              className="rounded-full bg-primary-light px-2 py-0.5 text-[10.5px] font-medium text-primary-text"
              title={
                dup
                  ? 'The AI judged this the same scenario as an existing case'
                  : 'The AI checked the existing cases and found no match'
              }
            >
              AI-checked
            </span>
          )}
          <select
            value={action}
            onChange={e => onRow({ action: e.target.value as Action })}
            className={cn(
              'ml-auto rounded-md border px-2.5 py-1 text-[12px] font-medium outline-none',
              action === 'skip'
                ? dup
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-border bg-surface-2 text-text-2'
                : action === 'create'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-sky-300 bg-sky-50 text-sky-800',
            )}
          >
            {actions.map(a => (
              <option key={a.v} value={a.v}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {dup && c.match && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {c.source === 'ai' ? 'AI found the same scenario in' : 'Similar to'}{' '}
              <b>#{c.match.caseNum}</b> “{c.match.title}”
              {c.source === 'ai' ? '' : ` · ${Math.round(c.match.similarity * 100)}% match`}
            </span>
            <button
              type="button"
              onClick={() => onRow({ diff: !row.diff, open: true })}
              className="font-medium underline underline-offset-2"
            >
              {row.diff ? 'Hide comparison' : 'Compare side by side'}
            </button>
          </div>
          {(action === 'update' || action === 'replace') && (
            <p className="mt-1.5 text-[11.5px] text-amber-800">
              {action === 'replace'
                ? 'Replace overwrites the description, preconditions, steps and expected result of the existing case. Its priority, labels and owner stay.'
                : 'Update changes only the fields ticked below; everything else on the existing case stays.'}
            </p>
          )}
          {action === 'update' && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {(Object.keys(FIELD_LABEL) as Field[]).map(f => (
                <label key={f} className="inline-flex items-center gap-1 text-[12px]">
                  <input
                    type="checkbox"
                    checked={row.fields.includes(f)}
                    onChange={e =>
                      onRow({
                        fields: e.target.checked
                          ? [...row.fields, f]
                          : row.fields.filter(x => x !== f),
                      })
                    }
                  />
                  {FIELD_LABEL[f]}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {row.diff && c.match && (
        <div className="grid grid-cols-1 gap-3 border-t border-border px-3 py-3 md:grid-cols-2">
          <DiffColumn
            title={`Existing · #${c.match.caseNum}`}
            c={{
              desc: c.match.desc,
              preconditions: c.match.preconditions,
              steps: c.match.steps.join('\n'),
              expected: c.match.expected,
            }}
            other={{
              desc: c.desc,
              preconditions: c.preconditions,
              steps: stepsText,
              expected: c.expected,
            }}
          />
          <DiffColumn
            title="Generated"
            c={{
              desc: c.desc,
              preconditions: c.preconditions,
              steps: stepsText,
              expected: c.expected,
            }}
            other={{
              desc: c.match.desc,
              preconditions: c.match.preconditions,
              steps: c.match.steps.join('\n'),
              expected: c.match.expected,
            }}
            highlight
          />
        </div>
      )}

      {row.open && !row.diff && (
        <div className="grid grid-cols-1 gap-3 border-t border-border px-3 py-3 md:grid-cols-2">
          <TextField
            label="Description"
            value={c.desc}
            onChange={v => onCase({ desc: v })}
            rows={3}
          />
          <TextField
            label="Preconditions"
            value={c.preconditions}
            onChange={v => onCase({ preconditions: v })}
            rows={3}
          />
          <TextField
            label="Steps (one per line)"
            value={stepsText}
            onChange={v =>
              onCase({
                steps: v
                  .split('\n')
                  .map(s => s.trim())
                  .filter(Boolean),
              })
            }
            rows={6}
          />
          <TextField
            label="Expected result"
            value={c.expected}
            onChange={v => onCase({ expected: v })}
            rows={6}
          />
        </div>
      )}
    </div>
  );
}

function MiniSelect({
  value,
  list,
  onChange,
}: {
  value: string;
  list: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11.5px] text-text-2 outline-none focus:border-primary"
    >
      {!list.includes(value) && <option value={value}>{value}</option>}
      {list.map(o => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function TextField({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
        {label}
      </label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] leading-relaxed text-text outline-none focus:border-primary"
      />
    </div>
  );
}

function DiffColumn({
  title,
  c,
  other,
  highlight,
}: {
  title: string;
  c: Record<'desc' | 'preconditions' | 'steps' | 'expected', string>;
  other: Record<'desc' | 'preconditions' | 'steps' | 'expected', string>;
  highlight?: boolean;
}) {
  const rows: { k: 'desc' | 'preconditions' | 'steps' | 'expected'; label: string }[] = [
    { k: 'desc', label: 'Description' },
    { k: 'preconditions', label: 'Preconditions' },
    { k: 'steps', label: 'Steps' },
    { k: 'expected', label: 'Expected result' },
  ];
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-2">
        {title}
      </p>
      <div className="flex flex-col gap-2">
        {rows.map(r => {
          const changed = c[r.k].trim() !== other[r.k].trim();
          return (
            <div
              key={r.k}
              className={cn(
                'rounded-md border px-2.5 py-1.5',
                changed
                  ? highlight
                    ? 'border-sky-300 bg-sky-50'
                    : 'border-amber-200 bg-amber-50'
                  : 'border-border bg-surface-2',
              )}
            >
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
                {r.label}
                {changed && <span className="ml-1 normal-case text-text-2">· differs</span>}
              </p>
              <p className="whitespace-pre-wrap break-words text-[12.5px] text-text">
                {c[r.k].trim() || '—'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
