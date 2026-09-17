'use client';

import { useEffect, useState } from 'react';
import { TestCase, CaseAttachment } from '@/types';
import { api } from '@/lib/client';
import { useCaseOptions, ClassificationField } from '@/components/features/CaseClassification';
import { StepEditor } from '@/components/ui/StepEditor';
import { AttachmentsField } from '@/components/ui/AttachmentsField';
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
    // priority/severity/type are category KEYS (see lib/options.ts) --
    // either a built-in enum literal or a custom WorkspaceOption.id -- not
    // narrowed to Priority/Severity/TestType like TestCase's own fields,
    // since a custom selection isn't one of those literals.
    patch: Omit<Partial<TestCase>, 'priority' | 'severity' | 'type'> & {
      priority?: string;
      severity?: string;
      type?: string;
      portalId?: string;
      moduleId?: string;
      suiteId?: string;
    },
  ) => void;
}

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
  // A custom override wins over the (possibly-placeholder) enum column --
  // same resolution rule as lib/options.ts's optionKeyOf().
  const [priority, setPriority] = useState(tc.customPriorityId ?? tc.priority);
  const [severity, setSeverity] = useState(tc.customSeverityId ?? tc.severity);
  const [type, setType] = useState(tc.customTypeId ?? tc.type);
  const [attachments, setAttachments] = useState<CaseAttachment[]>(tc.attachments ?? []);
  const [error, setError] = useState('');
  const caseOptions = useCaseOptions(projectId ?? '');

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
      attachments,
      ...(suiteId ? { suiteId } : moduleId ? { moduleId } : { portalId }),
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      {/* Topbar */}
      <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2">
        <button
          onClick={onBack}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-surface-2"
        >
          <i className="ti ti-arrow-left text-[13px]" />
          Back
        </button>
        <div className="flex flex-1 items-center gap-1 text-xs text-text-3">
          {breadcrumb} / <span className="font-mono font-semibold text-text">{tc.id}</span>
          <span
            className="ml-1 inline-block h-2 w-2 rounded-full bg-warning"
            title="Unsaved changes"
          />
        </div>
        <Button variant="default" onClick={onBack}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          <i className="ti ti-check text-[13px]" />
          Save
        </Button>
      </div>

      {/* Form — same grouped-sections + rail layout as "New test case". */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr_240px]">
        <div className="overflow-y-auto border-b border-border px-6 py-5 md:border-b-0 md:border-r">
          <div className="flex flex-col gap-4">
            <Field label="Title" required>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[15px] font-medium text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Priority" required>
                <ClassificationField
                  options={caseOptions.priority}
                  value={priority}
                  onChange={setPriority}
                />
              </Field>
              <Field label="Severity" required>
                <ClassificationField
                  options={caseOptions.severity}
                  value={severity}
                  onChange={setSeverity}
                />
              </Field>
              <Field label="Type" required>
                <ClassificationField options={caseOptions.type} value={type} onChange={setType} />
              </Field>
            </div>

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
                    className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                  />
                </Field>

                <Field label="Preconditions" hint="Lines starting with - or * render as bullets">
                  <textarea
                    value={preconditions}
                    onChange={e => setPreconditions(e.target.value)}
                    rows={3}
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

        {/* Right rail — Location cascade + at-a-glance facts, same split as
            "New test case". */}
        <div className="overflow-y-auto bg-surface-2 px-5 py-5">
          <div className="mb-5">
            <div className="mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-text">
              <i className="ti ti-map-pin text-[14px] text-primary" />
              Location
            </div>
            <div className="flex flex-col gap-2">
              <select
                value={portalId}
                disabled={loadingLocation}
                onChange={e => {
                  setPortalId(e.target.value);
                  setModuleId('');
                  setSuiteId('');
                }}
                className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-3"
              >
                <option value="">{loadingLocation ? 'Loading…' : 'Select a portal…'}</option>
                {tree.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={moduleId}
                disabled={loadingLocation || modules.length === 0}
                onChange={e => {
                  setModuleId(e.target.value);
                  setSuiteId('');
                }}
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
                disabled={loadingLocation || !mod || suiteOptions.length === 0}
                onChange={e => setSuiteId(e.target.value)}
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
                <span>Case ID</span>
                <span className="font-mono text-[11px] text-text-3">{tc.id}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border py-2">
                <span>Created by</span>
                <span className="font-medium text-text">{tc.author || '—'}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border py-2">
                <span>Created</span>
                <span className="text-text-3">{tc.created}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span>Updated</span>
                <span className="text-text-3">{tc.updatedFull}</span>
              </div>
            </div>
          </div>
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
