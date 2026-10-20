'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { cn, initials } from '@/lib/utils';
import { ApiTestCase, CaseAttachment, UserSummary } from '@/types';
import { useCaseOptions } from '@/components/features/CaseClassification';
import { AttachmentsField } from '@/components/ui/AttachmentsField';
import { Ico } from '@/components/features/tc-icons';
import { avatarGradient, caseCode, statusPillClass } from '@/components/features/tc-helpers';
import './testcase-v3.css';

// The shared Add / Edit test case page (mockup screen 05). One component for
// both flows so the two can't drift apart: create passes `mode="create"` and
// gets the "Auto-ID" hint + Save-as-draft; edit passes `mode="edit"` with the
// case's own code in the breadcrumb.

// Structurally matches the tree /api/portals returns (duck-typed — the list
// doesn't export its own types).
export interface FormTreeSuite {
  id: string;
  name: string;
  children: FormTreeSuite[];
}
export interface FormTreeModule {
  id: string;
  name: string;
  suites: FormTreeSuite[];
}
export interface FormTreePortal {
  id: string;
  name: string;
  modules: FormTreeModule[];
}

export type CaseStatusValue = 'Active' | 'Draft' | 'Archived';

export interface TestCaseFormValues {
  portalId: string;
  moduleId?: string;
  suiteId?: string;
  title: string;
  desc: string;
  preconditions: string;
  expected: string;
  steps: string[];
  priority: string;
  severity: string;
  type: string;
  status: CaseStatusValue;
  ownerId: string | null;
  labels: string[];
  attachments: CaseAttachment[];
}

export type FormIntent = 'draft' | 'save';

interface TestCaseFormProps {
  mode: 'create' | 'edit';
  projectId: string;
  projectName: string;
  tree: FormTreePortal[];
  initial: Partial<TestCaseFormValues> & { portalId: string };
  /** Edit mode: the case being edited, e.g. "C-0742". */
  code?: string;
  authorName: string;
  /** Edit mode: facts shown in the Visibility card. */
  meta?: { author?: string; created?: string; updated?: string };
  saving?: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (values: TestCaseFormValues, intent: FormIntent) => void;
}

// One selectable "Section" per tree node. The value encodes the node kind so a
// portal / module / suite pick resolves to exactly one parent id (the API
// requires exactly one).
interface SectionOption {
  value: string;
  label: string;
}

function buildSectionOptions(tree: FormTreePortal[]): SectionOption[] {
  const multi = tree.length > 1;
  const out: SectionOption[] = [];
  const walk = (suites: FormTreeSuite[], path: string) => {
    for (const s of suites) {
      const p = `${path} / ${s.name}`;
      out.push({ value: `s:${s.id}`, label: p });
      walk(s.children, p);
    }
  };
  for (const p of tree) {
    const base = multi ? `${p.name} / ` : '';
    out.push({ value: `p:${p.id}`, label: p.name });
    for (const m of p.modules) {
      out.push({ value: `m:${m.id}`, label: `${base}${m.name}` });
      walk(m.suites, `${base}${m.name}`);
    }
  }
  return out;
}

function sectionValueOf(v: { portalId?: string; moduleId?: string; suiteId?: string }): string {
  if (v.suiteId) return `s:${v.suiteId}`;
  if (v.moduleId) return `m:${v.moduleId}`;
  return v.portalId ? `p:${v.portalId}` : '';
}

/** Resolve a Section value back to {portalId, moduleId?, suiteId?} using the tree. */
function resolveSection(
  tree: FormTreePortal[],
  value: string,
): { portalId: string; moduleId?: string; suiteId?: string } | null {
  const [kind, id] = [value.slice(0, 1), value.slice(2)];
  if (!id) return null;
  if (kind === 'p') return { portalId: id };
  const hasSuite = (ss: FormTreeSuite[], sid: string): boolean =>
    ss.some(s => s.id === sid || hasSuite(s.children, sid));
  for (const p of tree) {
    for (const m of p.modules) {
      if (kind === 'm' && m.id === id) return { portalId: p.id, moduleId: m.id };
      if (kind === 's' && hasSuite(m.suites, id))
        return { portalId: p.id, moduleId: m.id, suiteId: id };
    }
  }
  return null;
}

// "1. Open the page" / "2) Click Save" → plain step text. Steps are stored as
// plain strings, so a leading list number the author typed is just noise.
function parseSteps(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.replace(/^\s*\d+[.)]\s+/, '').trim())
    .filter(Boolean);
}

export function TestCaseForm({
  mode,
  projectId,
  projectName,
  tree,
  initial,
  code,
  authorName,
  meta,
  saving,
  error,
  onCancel,
  onSubmit,
}: TestCaseFormProps) {
  const caseOptions = useCaseOptions(projectId);
  const sections = useMemo(() => buildSectionOptions(tree), [tree]);

  const [section, setSection] = useState(sectionValueOf(initial));
  const [title, setTitle] = useState(initial.title ?? '');
  const [desc, setDesc] = useState(initial.desc ?? '');
  const [preconditions, setPreconditions] = useState(initial.preconditions ?? '');
  const [expected, setExpected] = useState(initial.expected ?? '');
  const [stepsText, setStepsText] = useState((initial.steps ?? []).join('\n'));
  const [priority, setPriority] = useState(initial.priority ?? '');
  const [severity, setSeverity] = useState(initial.severity ?? '');
  const [type, setType] = useState(initial.type ?? '');
  const [status, setStatus] = useState<CaseStatusValue>(initial.status ?? 'Active');
  const [ownerId, setOwnerId] = useState<string | null>(initial.ownerId ?? null);
  const [labels, setLabels] = useState<string[]>(initial.labels ?? []);
  const [labelDraft, setLabelDraft] = useState('');
  const [attachments, setAttachments] = useState<CaseAttachment[]>(initial.attachments ?? []);
  const [localError, setLocalError] = useState('');

  // The tree can arrive after first render (edit mode fetches it); once it is
  // there, adopt the initial location.
  useEffect(() => {
    if (!section) setSection(sectionValueOf(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.portalId, initial.moduleId, initial.suiteId, tree]);

  // Default the classification pickers once the workspace options load (same
  // defaults the old modal used), without clobbering an edit's own values.
  useEffect(() => {
    if (!priority && caseOptions.priority.length > 0)
      setPriority(
        caseOptions.priority.find(o => o.name === 'High')?.key ?? caseOptions.priority[0].key,
      );
    if (!severity && caseOptions.severity.length > 0)
      setSeverity(
        caseOptions.severity.find(o => o.name === 'Major')?.key ?? caseOptions.severity[0].key,
      );
    if (!type && caseOptions.type.length > 0)
      setType(caseOptions.type.find(o => o.name === 'Functional')?.key ?? caseOptions.type[0].key);
  }, [caseOptions, priority, severity, type]);

  // Owner picker + "next ID" hint + related cases.
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [nextCode, setNextCode] = useState('');
  const [related, setRelated] = useState<{ id: string; caseNum: number; title: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<UserSummary[]>('/api/users')
      .then(u => !cancelled && setUsers(u))
      .catch(() => {});
    if (mode === 'create') {
      api
        .get<{ items: { caseNum: number }[] }>(
          `/api/test-cases?projectId=${projectId}&sort=caseNum&order=desc&pageSize=1`,
        )
        .then(r => !cancelled && setNextCode(caseCode((r.items[0]?.caseNum ?? 0) + 1)))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [mode, projectId]);

  const resolved = useMemo(() => resolveSection(tree, section), [tree, section]);
  useEffect(() => {
    if (!resolved) {
      setRelated([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ pageSize: '4', sort: 'caseNum', order: 'desc' });
    if (resolved.suiteId) params.set('suiteId', resolved.suiteId);
    else if (resolved.moduleId) params.set('moduleId', resolved.moduleId);
    else params.set('portalId', resolved.portalId);
    api
      .get<{ items: { id: string; caseNum: number; title: string }[] }>(
        `/api/test-cases?${params.toString()}`,
      )
      .then(r => {
        if (cancelled) return;
        const mine = code?.replace(/^C-0*/, '');
        setRelated(r.items.filter(i => String(i.caseNum) !== mine).slice(0, 3));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resolved, code]);

  const sectionLabel = sections.find(s => s.value === section)?.label ?? '';

  const addLabel = () => {
    const l = labelDraft.trim().replace(/^@?/, '@');
    if (l.length > 1 && !labels.includes(l)) setLabels([...labels, l]);
    setLabelDraft('');
  };

  const submit = (intent: FormIntent) => {
    setLocalError('');
    if (!title.trim()) return setLocalError('Title is required');
    if (!resolved) return setLocalError('Pick a section');
    const steps = parseSteps(stepsText);
    if (steps.length === 0) return setLocalError('At least one step is required');
    onSubmit(
      {
        ...resolved,
        title: title.trim(),
        desc,
        preconditions,
        expected,
        steps,
        priority,
        severity,
        type,
        status: intent === 'draft' ? 'Draft' : status,
        ownerId,
        labels,
        attachments,
      },
      intent,
    );
  };

  const shownError = localError || error;

  return (
    <div className="tcv3 main-scroll">
      <div className="breadcrumb">
        <span className="crumb">{projectName || 'Project'}</span>
        <span className="sep">/</span>
        <button type="button" className="crumb-link" onClick={onCancel}>
          Test cases
        </button>
        {sectionLabel && (
          <>
            <span className="sep">/</span>
            <span className="crumb">{sectionLabel.split(' / ').slice(-1)[0]}</span>
          </>
        )}
        <span className="sep">/</span>
        <span className="current">{mode === 'create' ? 'New case' : (code ?? 'Edit')}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title compact">
            {mode === 'create' ? 'New test case' : 'Edit test case'}
          </h1>
          <div className="page-sub">
            Section <b style={{ color: 'var(--t-2)' }}>{sectionLabel || '—'}</b>
            {mode === 'create' ? (
              <>
                {' '}
                · Auto-ID will be assigned on save
                {nextCode && (
                  <>
                    {' '}
                    (next: <b style={{ color: 'var(--t-2)' }}>{nextCode}</b>)
                  </>
                )}
              </>
            ) : (
              code && (
                <>
                  {' '}
                  · <b style={{ color: 'var(--t-2)' }}>{code}</b>
                </>
              )
            )}
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          {mode === 'create' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => submit('draft')}
              disabled={saving}
            >
              Save as draft
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => submit('save')}
            disabled={saving}
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Save test case' : 'Save changes'}
          </button>
        </div>
      </div>

      {shownError && <div className="form-error">{shownError}</div>}

      <div className="tc-form-cols">
        <div>
          <div className="card card-pad-lg" style={{ marginBottom: 16 }}>
            <div className="field" style={{ marginBottom: 18 }}>
              <label className="label">
                Title <span className="req">*</span>
              </label>
              <input
                className="input"
                style={{ fontSize: 16, fontWeight: 500, padding: '12px 14px' }}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Describe what this test verifies…"
              />
            </div>

            <div className="form-grid three">
              <div className="field">
                <label className="label">
                  Section <span className="req">*</span>
                </label>
                <select
                  className="select"
                  value={section}
                  onChange={e => setSection(e.target.value)}
                >
                  {!section && <option value="">Select a section…</option>}
                  {sections.map(s => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">
                  Type <span className="req">*</span>
                </label>
                <select className="select" value={type} onChange={e => setType(e.target.value)}>
                  {caseOptions.type.map(o => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">
                  Priority <span className="req">*</span>
                </label>
                <select
                  className="select"
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                >
                  {caseOptions.priority.map(o => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">Severity</label>
                <select
                  className="select"
                  value={severity}
                  onChange={e => setSeverity(e.target.value)}
                >
                  {caseOptions.severity.map(o => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">Status</label>
                <select
                  className="select"
                  value={status}
                  onChange={e => setStatus(e.target.value as CaseStatusValue)}
                >
                  <option value="Active">Active</option>
                  <option value="Draft">Draft</option>
                  <option value="Archived">Archived</option>
                </select>
              </div>
              <div className="field">
                <label className="label">Owner</label>
                <select
                  className="select"
                  value={ownerId ?? ''}
                  onChange={e => setOwnerId(e.target.value || null)}
                >
                  <option value="">Unassigned</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name || u.username}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field" style={{ marginTop: 18 }}>
              <label className="label">
                Labels <span className="hint">Press Enter to add</span>
              </label>
              <div className="tag-input">
                {labels.map(l => (
                  <span key={l} className="tag">
                    {l}{' '}
                    <button
                      type="button"
                      className="x"
                      aria-label={`Remove ${l}`}
                      onClick={() => setLabels(labels.filter(x => x !== l))}
                    >
                      <Ico name="x" />
                    </button>
                  </span>
                ))}
                <input
                  placeholder="Add label…"
                  value={labelDraft}
                  onChange={e => setLabelDraft(e.target.value)}
                  onBlur={addLabel}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addLabel();
                    }
                    if (e.key === 'Backspace' && !labelDraft && labels.length)
                      setLabels(labels.slice(0, -1));
                  }}
                />
              </div>
            </div>
          </div>

          <div className="card card-pad-lg" style={{ marginBottom: 16 }}>
            <h3 className="card-title">
              <Ico name="file" size={14} />
              Test details
            </h3>
            <div className="form-grid full">
              <div className="field">
                <label className="label">Description</label>
                <textarea
                  className="textarea"
                  placeholder="What does this test verify?"
                  value={desc}
                  onChange={e => setDesc(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="label">
                  Preconditions{' '}
                  <span className="hint">Lines starting with - or * render as bullets</span>
                </label>
                <textarea
                  className="textarea"
                  placeholder={'- User is signed in\n- Test data is loaded'}
                  value={preconditions}
                  onChange={e => setPreconditions(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="label">
                  Steps <span className="req">*</span>
                  <span className="hint">One step per line</span>
                </label>
                <textarea
                  className="textarea"
                  style={{ minHeight: 140 }}
                  placeholder={'1. Open the page\n2. Perform the action\n3. Observe the result'}
                  value={stepsText}
                  onChange={e => setStepsText(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="label">Expected result</label>
                <textarea
                  className="textarea"
                  placeholder="What should happen?"
                  value={expected}
                  onChange={e => setExpected(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card card-pad-lg">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <h3 className="card-title" style={{ marginBottom: 0 }}>
                <Ico name="upload-cloud" size={14} />
                Attachments
              </h3>
              <span style={{ fontSize: 12, color: 'var(--t-3)' }}>Max 5 MB per file</span>
            </div>
            <AttachmentsField attachments={attachments} onChange={setAttachments} />
          </div>
        </div>

        {/* Right rail */}
        <div className="rail">
          <div className="card">
            <div className="card-head">
              <h3>Visibility</h3>
            </div>
            <div className="card-pad" style={{ fontSize: 12.5, color: 'var(--t-2)' }}>
              <div className="vis-row">
                <span>Status</span>
                <span className={cn('pill', statusPillClass(status))}>
                  {status !== 'Archived' && <span className="dot" />} {status}
                </span>
              </div>
              <div className="vis-row">
                <span>{mode === 'create' ? 'Created by' : 'Author'}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div
                    className="avatar xs"
                    style={{ background: avatarGradient(meta?.author ?? authorName) }}
                  >
                    {initials(meta?.author ?? authorName).slice(0, 1)}
                  </div>{' '}
                  {meta?.author || authorName || 'You'}
                </span>
              </div>
              {mode === 'create' ? (
                <>
                  <div className="vis-row">
                    <span>Version</span>
                    <span style={{ fontFamily: 'var(--f-mono)', color: 'var(--t-3)' }}>
                      v1 (new)
                    </span>
                  </div>
                  <div className="vis-row" style={{ borderBottom: 'none' }}>
                    <span>Linked to runs</span>
                    <span className="pill pill-neutral">0 runs</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="vis-row">
                    <span>Created</span>
                    <span style={{ color: 'var(--t-3)' }}>{meta?.created ?? '—'}</span>
                  </div>
                  <div className="vis-row" style={{ borderBottom: 'none' }}>
                    <span>Updated</span>
                    <span style={{ color: 'var(--t-3)' }}>{meta?.updated ?? '—'}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Related cases</h3>
            </div>
            <div style={{ padding: 6 }}>
              {related.length === 0 ? (
                <div className="rel-empty">No other cases in this section yet.</div>
              ) : (
                related.map(r => (
                  <div key={r.id} className="rel-item">
                    <div className="rel-id">{caseCode(r.caseNum)}</div>
                    <div className="rel-title">{r.title}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Convenience for callers that hold an ApiTestCase.
export function formValuesFromApiCase(tc: ApiTestCase): Partial<TestCaseFormValues> {
  return {
    title: tc.title,
    desc: tc.desc,
    preconditions: tc.preconditions,
    expected: tc.expected,
    steps: (tc.steps as unknown as string[]) ?? [],
    priority: tc.customPriorityId ?? tc.priority,
    severity: tc.customSeverityId ?? tc.severity,
    type: tc.customTypeId ?? tc.type,
    status: tc.status as CaseStatusValue,
    ownerId: tc.ownerId ?? null,
    labels: tc.labels ?? [],
    attachments: tc.attachments ?? [],
  };
}
