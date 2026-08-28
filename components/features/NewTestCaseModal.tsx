'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { StepEditor } from '@/components/ui/StepEditor';
import { Priority, Severity, TestType, ApiTestCase } from '@/types';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 pb-4 pt-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">New test case</h2>
            {targetLabel && (
              <p className="mt-0.5 text-[12px] text-slate-400">
                Will be added to <span className="font-medium text-slate-600">{targetLabel}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-4">
            {/* Location cascade — Portal required, Module/Suite optional drill-down. */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Location
              </p>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={portalId}
                  onChange={e => {
                    setPortalId(e.target.value);
                    setModuleId('');
                    setSuiteId('');
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500"
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
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
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
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
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

            <hr className="border-slate-100" />

            {/* Properties */}
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Priority" required>
                <SegmentedRow
                  value={priority}
                  onChange={v => setPriority(v as Priority)}
                  options={[
                    { value: 'High', label: 'High', active: 'bg-red-100 text-red-800' },
                    { value: 'Medium', label: 'Med', active: 'bg-amber-100 text-amber-800' },
                    { value: 'Low', label: 'Low', active: 'bg-green-100 text-green-800' },
                  ]}
                />
              </Field>
              <Field label="Severity" required>
                <SegmentedRow
                  value={severity}
                  onChange={v => setSeverity(v as Severity)}
                  options={[
                    { value: 'Critical', label: 'Critical', active: 'bg-red-100 text-red-800' },
                    { value: 'Major', label: 'Major', active: 'bg-amber-100 text-amber-800' },
                    { value: 'Minor', label: 'Minor', active: 'bg-green-100 text-green-800' },
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
                      className={`cursor-pointer rounded border px-2 py-1 text-xs transition-all ${
                        type === t
                          ? 'border-blue-500 bg-indigo-50 font-semibold text-blue-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            <Field label="Title" required>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Describe what this test verifies…"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </Field>

            <Field label="Description">
              <textarea
                value={desc}
                onChange={e => setDesc(e.target.value)}
                rows={2}
                placeholder="Optional background context…"
                className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </Field>

            <Field label="Preconditions">
              <textarea
                value={preconditions}
                onChange={e => setPreconditions(e.target.value)}
                rows={2}
                placeholder={'- User is signed in\n- Test data is loaded'}
                className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
                className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </Field>

            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-3.5 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="cursor-pointer rounded-lg bg-blue-600 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label className="text-[11px] font-semibold text-slate-500">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function SegmentedRow<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; active: string }[];
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-200">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1.5 text-xs transition-colors ${
            value === o.value
              ? `font-semibold ${o.active}`
              : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
