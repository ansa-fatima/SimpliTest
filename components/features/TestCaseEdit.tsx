'use client';

import { useEffect, useState } from 'react';
import { TestCase, Priority, Severity, TestType } from '@/types';
import { api } from '@/lib/client';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { StepEditor } from '@/components/ui/StepEditor';
import { Button } from '@/components/ui/Button';

// Structurally matches the tree shape /api/portals returns — same duck-typed
// approach NewTestCaseModal uses, since there's no shared exported type for it.
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

interface TestCaseEditProps {
  tc: TestCase;
  projectId: string | null;
  onBack: () => void;
  onSave: (
    patch: Partial<TestCase> & { portalId?: string; moduleId?: string; suiteId?: string },
  ) => void;
}

const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];

// Flattens a suite tree into (id, label) pairs, indenting nested names for select display.
function flattenSuites(suites: TreeSuite[], depth = 0): { id: string; label: string }[] {
  return suites.flatMap(s => [
    { id: s.id, label: `${'—'.repeat(depth)}${depth > 0 ? ' ' : ''}${s.name}` },
    ...flattenSuites(s.children, depth + 1),
  ]);
}

function containsSuite(suites: TreeSuite[], id: string): boolean {
  return suites.some(s => s.id === id || containsSuite(s.children, id));
}

export function TestCaseEdit({ tc, projectId, onBack, onSave }: TestCaseEditProps) {
  const [title, setTitle] = useState(tc.title);
  const [desc, setDesc] = useState(tc.desc);
  const [preconditions, setPreconditions] = useState(tc.preconditions ?? '');
  const [expected, setExpected] = useState(tc.expected);
  const [steps, setSteps] = useState<string[]>(tc.steps);
  const [priority, setPriority] = useState<Priority>(tc.priority);
  const [severity, setSeverity] = useState<Severity>(tc.severity);
  const [type, setType] = useState<TestType>(tc.type);
  const [error, setError] = useState('');

  // Location — Portal → Module → Suite, fetched fresh from the API. The
  // legacy in-memory `TestCase` shape only carries a flattened `feature`
  // string, not the structured ids a case actually needs to be re-parented.
  const [tree, setTree] = useState<TreePortal[]>([]);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [portalId, setPortalId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [suiteId, setSuiteId] = useState('');

  useEffect(() => {
    if (!tc.apiId || !projectId) {
      setLoadingLocation(false);
      return;
    }
    (async () => {
      try {
        const [treeData, raw] = await Promise.all([
          api.get<TreePortal[]>(`/api/portals?projectId=${projectId}`),
          api.get<{ portalId: string | null; moduleId: string | null; suiteId: string | null }>(
            `/api/test-cases/${tc.apiId}`,
          ),
        ]);
        setTree(treeData);
        if (raw.suiteId) {
          const owner = treeData
            .flatMap(p => p.modules.map(m => ({ p, m })))
            .find(({ m }) => containsSuite(m.suites, raw.suiteId!));
          if (owner) {
            setPortalId(owner.p.id);
            setModuleId(owner.m.id);
            setSuiteId(raw.suiteId);
          }
        } else if (raw.moduleId) {
          const owner = treeData.find(p => p.modules.some(m => m.id === raw.moduleId));
          if (owner) {
            setPortalId(owner.id);
            setModuleId(raw.moduleId);
          }
        } else if (raw.portalId) {
          setPortalId(raw.portalId);
        }
      } catch (e) {
        console.error('[edit location]', e);
      } finally {
        setLoadingLocation(false);
      }
    })();
  }, [tc.apiId, projectId]);

  const portal = tree.find(p => p.id === portalId);
  const modules = portal?.modules ?? [];
  const mod = modules.find(m => m.id === moduleId);
  const suiteOptions = mod ? flattenSuites(mod.suites) : [];

  useEffect(() => {
    if (moduleId && !modules.some(m => m.id === moduleId)) setModuleId('');
  }, [portalId, modules, moduleId]);
  useEffect(() => {
    if (suiteId && !suiteOptions.some(s => s.id === suiteId)) setSuiteId('');
  }, [moduleId, suiteOptions, suiteId]);

  const suiteLabel = suiteOptions.find(s => s.id === suiteId)?.label.replace(/^—+\s*/, '');
  const breadcrumb =
    [portal?.name, mod?.name, suiteId ? suiteLabel : null].filter(Boolean).join(' / ') || '…';

  const handleSave = () => {
    setError('');
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!portalId) {
      setError('Pick a portal');
      return;
    }
    const cleanSteps = steps.map(s => s.trim()).filter(Boolean);
    if (cleanSteps.length === 0) {
      setError('At least one step is required');
      return;
    }
    onSave({
      title: title.trim(),
      sub: desc.split('.')[0] || title.trim(),
      desc,
      preconditions,
      expected,
      steps: cleanSteps,
      priority,
      severity,
      type,
      ...(suiteId ? { suiteId } : moduleId ? { moduleId } : { portalId }),
    });
  };

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
        <div className="flex flex-1 items-center gap-1 text-xs text-slate-400">
          {breadcrumb} / <span className="font-mono font-semibold text-slate-800">{tc.id}</span>
          <span
            className="ml-1 inline-block h-2 w-2 rounded-full bg-amber-400"
            title="Unsaved changes"
          />
        </div>
        <Button variant="default" onClick={onBack}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M2 8l5 5 7-9" />
          </svg>
          Save
        </Button>
      </div>

      {/* Form */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
        {/* Properties section */}
        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Properties
          </p>
          <div className="flex flex-wrap items-end gap-3">
            {/* Case ID (readonly) */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">Case ID</label>
              <input
                type="text"
                value={tc.id}
                readOnly
                className="w-[90px] cursor-default rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-400 outline-none"
              />
            </div>

            {/* Portal */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">
                Portal <span className="text-red-500">*</span>
              </label>
              <select
                value={portalId}
                disabled={loadingLocation}
                onChange={e => {
                  setPortalId(e.target.value);
                  setModuleId('');
                  setSuiteId('');
                }}
                className="w-[130px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">{loadingLocation ? 'Loading…' : 'Select a portal…'}</option>
                {tree.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Module */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">Module</label>
              <select
                value={moduleId}
                disabled={loadingLocation || modules.length === 0}
                onChange={e => {
                  setModuleId(e.target.value);
                  setSuiteId('');
                }}
                className="w-[130px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">Attach to portal directly</option>
                {modules.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Suite / feature */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">Feature</label>
              <select
                value={suiteId}
                disabled={loadingLocation || !mod || suiteOptions.length === 0}
                onChange={e => setSuiteId(e.target.value)}
                className="w-[130px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">Attach to module directly</option>
                {suiteOptions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">
                Priority <span className="text-red-500">*</span>
              </label>
              <SegmentedControl
                value={priority}
                onChange={v => setPriority(v as Priority)}
                options={[
                  {
                    value: 'High',
                    label: 'High',
                    activeClass: 'bg-red-100 text-red-800 font-semibold',
                  },
                  {
                    value: 'Medium',
                    label: 'Med',
                    activeClass: 'bg-amber-100 text-amber-800 font-semibold',
                  },
                  {
                    value: 'Low',
                    label: 'Low',
                    activeClass: 'bg-green-100 text-green-800 font-semibold',
                  },
                ]}
              />
            </div>

            {/* Severity */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">
                Severity <span className="text-red-500">*</span>
              </label>
              <SegmentedControl
                value={severity}
                onChange={v => setSeverity(v as Severity)}
                options={[
                  {
                    value: 'Critical',
                    label: 'Critical',
                    activeClass: 'bg-red-100 text-red-800 font-semibold',
                  },
                  {
                    value: 'Major',
                    label: 'Major',
                    activeClass: 'bg-amber-100 text-amber-800 font-semibold',
                  },
                  {
                    value: 'Minor',
                    label: 'Minor',
                    activeClass: 'bg-green-100 text-green-800 font-semibold',
                  },
                ]}
              />
            </div>

            {/* Type */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">
                Type <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-wrap gap-1">
                {TYPES.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`cursor-pointer rounded border px-2 py-1 text-xs transition-all ${type === t ? 'border-blue-500 bg-indigo-50 font-semibold text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Title */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-600">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-sans text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-600">Description</label>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={2}
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-sans text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {/* Preconditions — what must already be true before running this case. */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-600">
            Preconditions <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            value={preconditions}
            onChange={e => setPreconditions(e.target.value)}
            rows={3}
            placeholder={'- User is signed in\n- Test data is loaded\n- Feature flag X is enabled'}
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-sans text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <p className="text-[10.5px] text-slate-400">
            Lines starting with <code className="rounded bg-slate-100 px-1">- </code> or{' '}
            <code className="rounded bg-slate-100 px-1">* </code> render as bullets in the view.
          </p>
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-600">
            Steps <span className="text-red-500">*</span>
          </label>
          <StepEditor steps={steps} onChange={setSteps} />
        </div>

        {/* Expected */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-600">Expected result</label>
          <textarea
            value={expected}
            onChange={e => setExpected(e.target.value)}
            rows={2}
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-sans text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

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
