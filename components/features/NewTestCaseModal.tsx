'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';
import { StepEditor } from '@/components/ui/StepEditor';
import { AttachmentsField } from '@/components/ui/AttachmentsField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Priority, Severity, TestType, ApiTestCase, CaseAttachment } from '@/types';

// Structurally matches the tree shape TestCaseList already fetches from
// /api/portals — kept local/duck-typed since TestCaseList doesn't export its
// internal ApiPortal/ApiModule/ApiSuite types.
interface TreeSuite {
  id: string;
  name: string;
  children: TreeSuite[];
}
interface TreeModule {
  id: string;
  name: string;
  suites: TreeSuite[];
}
interface TreePortal {
  id: string;
  name: string;
  modules: TreeModule[];
}

interface NewTestCaseModalProps {
  tree: TreePortal[];
  /** Pre-selects the cascade to match whatever node was active when "New case" was clicked. */
  initial: { portalId: string; moduleId?: string; suiteId?: string };
  authorName: string;
  onClose: () => void;
  onCreated: (tc: ApiTestCase) => void;
}

const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];

// Flattens a suite tree into (id, name, depth) pairs, indented for select display.
function flattenSuites(suites: TreeSuite[], depth = 0): { id: string; label: string }[] {
  return suites.flatMap(s => [
    { id: s.id, label: `${'—'.repeat(depth)}${depth > 0 ? ' ' : ''}${s.name}` },
    ...flattenSuites(s.children, depth + 1),
  ]);
}

export function NewTestCaseModal({
  tree,
  initial,
  authorName,
  onClose,
  onCreated,
}: NewTestCaseModalProps) {
  // Cascading target — exactly one of portal/module/suite ends up as the case's
  // parent. Picking a module clears any suite pick; picking a portal clears both.
  const [portalId, setPortalId] = useState(initial.portalId);
  const [moduleId, setModuleId] = useState(initial.moduleId ?? '');
  const [suiteId, setSuiteId] = useState(initial.suiteId ?? '');

  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [preconditions, setPreconditions] = useState('');
  const [expected, setExpected] = useState('');
  const [steps, setSteps] = useState<string[]>(['']);
  const [priority, setPriority] = useState<Priority>('High');
  const [severity, setSeverity] = useState<Severity>('Critical');
  const [type, setType] = useState<TestType>('Functional');
  const [attachments, setAttachments] = useState<CaseAttachment[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const portal = tree.find(p => p.id === portalId);
  const modules = portal?.modules ?? [];
  const mod = modules.find(m => m.id === moduleId);
  const suiteOptions = mod ? flattenSuites(mod.suites) : [];

  // Keep module/suite valid whenever the portal changes (e.g. module belonged
  // to the previous portal). Suite is re-validated against the current module.
  useEffect(() => {
    if (moduleId && !modules.some(m => m.id === moduleId)) setModuleId('');
  }, [portalId, modules, moduleId]);
  useEffect(() => {
    if (suiteId && !suiteOptions.some(s => s.id === suiteId)) setSuiteId('');
  }, [moduleId, suiteOptions, suiteId]);

  const targetLabel = suiteId
    ? (suiteOptions.find(s => s.id === suiteId)?.label.replace(/^—+\s*/, '') ?? '')
    : mod
      ? mod.name
      : (portal?.name ?? '');

  const handleSave = async () => {
    setError('');
    if (!portalId) {
      setError('Pick a portal');
      return;
    }
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    const cleanSteps = steps.map(s => s.trim()).filter(Boolean);
    if (cleanSteps.length === 0) {
      setError('At least one step is required');
      return;
    }
    setSaving(true);
    try {
      const tc = await api.post<ApiTestCase>('/api/test-cases', {
        title: title.trim(),
        desc,
        preconditions,
        steps: cleanSteps,
        expected,
        priority,
        severity,
        type,
        author: authorName,
        attachments,
        // Exactly one of these three — deepest pick wins.
        ...(suiteId ? { suiteId } : moduleId ? { moduleId } : { portalId }),
      });
      onCreated(tc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-[960px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 pb-4 pt-5">
          <div>
            <h2 className="text-base font-bold text-text">New test case</h2>
            {targetLabel && (
              <p className="mt-0.5 text-[12px] text-text-3">
                Will be added to <span className="font-medium text-text-2">{targetLabel}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <i className="ti ti-x text-[18px]" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_240px]">
          {/* Main content */}
          <div className="overflow-y-auto border-b border-border px-6 py-5 md:border-b-0 md:border-r">
            <div className="flex flex-col gap-4">
              {/* Title first and prominent — the one field every case needs
                  a good, scannable summary of before anything else. */}
              <Field label="Title" required>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Describe what this test verifies…"
                  className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[15px] font-medium text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                />
              </Field>

              {/* Classification — grouped in one row so priority/severity/type
                  read as one "how important, what kind" decision. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Priority" required>
                  <SegmentedControl
                    value={priority}
                    onChange={v => setPriority(v as Priority)}
                    options={[
                      {
                        value: 'High',
                        label: 'High',
                        activeClass: 'bg-pill-high-bg text-pill-high-text',
                      },
                      {
                        value: 'Medium',
                        label: 'Med',
                        activeClass: 'bg-pill-medium-bg text-pill-medium-text',
                      },
                      {
                        value: 'Low',
                        label: 'Low',
                        activeClass: 'bg-pill-low-bg text-pill-low-text',
                      },
                    ]}
                  />
                </Field>
                <Field label="Severity" required>
                  <SegmentedControl
                    value={severity}
                    onChange={v => setSeverity(v as Severity)}
                    options={[
                      {
                        value: 'Critical',
                        label: 'Critical',
                        activeClass: 'bg-pill-high-bg text-pill-high-text',
                      },
                      {
                        value: 'Major',
                        label: 'Major',
                        activeClass: 'bg-pill-medium-bg text-pill-medium-text',
                      },
                      {
                        value: 'Minor',
                        label: 'Minor',
                        activeClass: 'bg-pill-low-bg text-pill-low-text',
                      },
                    ]}
                  />
                </Field>
                <Field label="Type" required>
                  <div className="flex flex-wrap gap-1">
                    {TYPES.map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={cn(
                          'cursor-pointer rounded border px-2 py-1 text-xs transition-all',
                          type === t
                            ? 'border-primary bg-primary-light font-semibold text-primary-text'
                            : 'border-border bg-surface text-text-3 hover:bg-surface-2',
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              {/* Test details — everything about what the test actually does,
                  grouped into its own section so it reads apart from the
                  classification fields above. */}
              <div className="mt-1 rounded-xl border border-border bg-surface p-4">
                <div className="mb-3.5 flex items-center gap-2 text-[13px] font-semibold text-text">
                  <i className="ti ti-file-text text-[15px] text-primary" />
                  Test details
                </div>
                <div className="flex flex-col gap-4">
                  <Field label="Description">
                    <textarea
                      value={desc}
                      onChange={e => setDesc(e.target.value)}
                      rows={2}
                      placeholder="Optional background context…"
                      className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                    />
                  </Field>

                  <Field label="Preconditions">
                    <textarea
                      value={preconditions}
                      onChange={e => setPreconditions(e.target.value)}
                      rows={2}
                      placeholder={'- User is signed in\n- Test data is loaded'}
                      className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                    />
                  </Field>

                  <Field label="Steps" required>
                    <StepEditor steps={steps} onChange={setSteps} />
                  </Field>

                  <Field label="Expected result">
                    <textarea
                      value={expected}
                      onChange={e => setExpected(e.target.value)}
                      rows={2}
                      placeholder="What should happen?"
                      className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                    />
                  </Field>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-3.5 flex items-center gap-2 text-[13px] font-semibold text-text">
                  <i className="ti ti-paperclip text-[15px] text-primary" />
                  Attachments
                </div>
                <AttachmentsField attachments={attachments} onChange={setAttachments} />
              </div>

              {error && <p className="text-xs text-danger">{error}</p>}
            </div>
          </div>

          {/* Right rail — Location cascade + at-a-glance facts about the
              case being created. No Related cases / Attachments here: there's
              no real relation or file-storage feature behind either yet. */}
          <div className="overflow-y-auto bg-surface-2 px-5 py-5">
            <div className="mb-5">
              <div className="mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-text">
                <i className="ti ti-map-pin text-[14px] text-primary" />
                Location
              </div>
              <div className="flex flex-col gap-2">
                <select
                  value={portalId}
                  onChange={e => {
                    setPortalId(e.target.value);
                    setModuleId('');
                    setSuiteId('');
                  }}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-primary"
                >
                  {tree.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={moduleId}
                  onChange={e => {
                    setModuleId(e.target.value);
                    setSuiteId('');
                  }}
                  disabled={modules.length === 0}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-3"
                >
                  <option value="">Attach to portal directly</option>
                  {modules.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <select
                  value={suiteId}
                  onChange={e => setSuiteId(e.target.value)}
                  disabled={!mod || suiteOptions.length === 0}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-3"
                >
                  <option value="">Attach to module directly</option>
                  {suiteOptions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-text">
                <i className="ti ti-info-circle text-[14px] text-primary" />
                Details
              </div>
              <div className="flex flex-col text-[12px] text-text-2">
                <div className="flex items-center justify-between border-b border-border py-2">
                  <span>Created by</span>
                  <span className="flex items-center gap-1.5 font-medium text-text">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-light text-[8px] font-bold text-primary-text">
                      {authorName.slice(0, 1).toUpperCase()}
                    </span>
                    {authorName || 'You'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span>Linked to runs</span>
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10.5px] text-text-2">
                    0 runs
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-3.5 py-2 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="cursor-pointer rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save test case'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label className="text-[11px] font-semibold text-text-2">
        {label} {required && <span className="text-danger">*</span>}
        {hint && <span className="ml-1.5 font-normal normal-case text-text-3">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
