'use client';

import { useEffect, useState } from 'react';
import { CycleScopeType, CycleMode, Module, TestCycle } from '@/types';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

interface ApiModule {
  id: string;
  name: string;
  portalId: string;
  suites: { id: string; name: string }[];
}
interface ApiPortal {
  id: string;
  name: string;
}

export interface CycleFormPayload {
  name: string;
  description?: string;
  mode?: CycleMode;
  scopeType?: CycleScopeType;
  scopeId?: string | null;
  targetDate?: string | null;
  // Manual-mode fields
  moduleName?: string;
  featureName?: string;
  environment?: string;
  platform?: string;
  version?: string;
  cycleCategory?: string;
  ticketLink?: string;
  issueCount?: number;
  criticalCount?: number;
  majorCount?: number;
  minorCount?: number;
  doneCount?: number;
  remainingCount?: number;
  passedCount?: number;
  failedCount?: number;
  blockedCount?: number;
}

interface NewCycleModalProps {
  modules: Module[]; // unused — we fetch fresh from API
  projectId: string | null;
  onClose: () => void;
  onSave: (input: CycleFormPayload) => Promise<void>;
  /** When provided, the modal opens in edit mode for an existing cycle (Manual only). */
  initial?: TestCycle | null;
  /** Default mode when opening fresh — useful for the "+ Quick log" entry point. */
  defaultMode?: CycleMode;
}

const ENVIRONMENTS = ['Production', 'QA', 'Staging', 'Dev'];
const PLATFORMS = ['Android', 'iPhone', 'Web', 'All', 'Desktop'];
const CYCLE_CATEGORIES = ['Stability', 'Regression', 'Functional', 'UI', 'Performance', 'Smoke'];

export function NewCycleModal({
  projectId,
  onClose,
  onSave,
  initial = null,
  defaultMode = 'CaseBased',
}: NewCycleModalProps) {
  const isEdit = !!initial;
  const [mode, setMode] = useState<CycleMode>(initial?.mode ?? defaultMode);

  // ── Core fields ─────────────────────────────────────────────
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [targetDate, setTargetDate] = useState(
    initial?.targetDate ? initial.targetDate.slice(0, 10) : '',
  );

  // ── CaseBased-mode fields ──────────────────────────────────
  // Three independent, OPTIONAL selections. The deepest non-empty value
  // determines the cycle's effective scope on submit (suite > module > portal > All).
  const [portalIdF, setPortalIdF] = useState<string>(
    initial?.scopeType === 'Portal' ? (initial.scopeId ?? '') : '',
  );
  const [moduleIdF, setModuleIdF] = useState<string>(
    initial?.scopeType === 'Module' ? (initial.scopeId ?? '') : '',
  );
  const [suiteIdF, setSuiteIdF] = useState<string>(
    initial?.scopeType === 'Suite' ? (initial.scopeId ?? '') : '',
  );
  const [modules, setModules] = useState<ApiModule[]>([]);
  const [portals, setPortals] = useState<ApiPortal[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);

  // ── Manual-mode fields ──────────────────────────────────────
  const [moduleName, setModuleName] = useState(initial?.moduleName ?? '');
  const [featureName, setFeatureName] = useState(initial?.featureName ?? '');
  const [environment, setEnvironment] = useState(initial?.environment ?? '');
  const [platform, setPlatform] = useState(initial?.platform ?? '');
  const [version, setVersion] = useState(initial?.version ?? '');
  const [cycleCategory, setCycleCategory] = useState(initial?.cycleCategory ?? '');
  const [ticketLink, setTicketLink] = useState(initial?.ticketLink ?? '');
  const [issueCount, setIssueCount] = useState(initial?.issueCount ?? 0);
  const [criticalCount, setCriticalCount] = useState(initial?.criticalCount ?? 0);
  const [majorCount, setMajorCount] = useState(initial?.majorCount ?? 0);
  const [minorCount, setMinorCount] = useState(initial?.minorCount ?? 0);
  const [doneCount, setDoneCount] = useState(initial?.doneCount ?? 0);
  const [remainingCount, setRemainingCount] = useState(initial?.remainingCount ?? 0);
  const [passedCount, setPassedCount] = useState(initial?.passedCount ?? 0);
  const [failedCount, setFailedCount] = useState(initial?.failedCount ?? 0);
  const [blockedCount, setBlockedCount] = useState(initial?.blockedCount ?? 0);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const modUrl = projectId ? `/api/modules?projectId=${projectId}` : '/api/modules';
        const [mods, ports] = await Promise.all([
          api.get<ApiModule[]>(modUrl),
          projectId
            ? api
                .get<{ id: string; name: string }[]>(`/api/portals?projectId=${projectId}`)
                .catch(() => [])
            : Promise.resolve([]),
        ]);
        setModules(mods);
        setPortals(ports.map(p => ({ id: p.id, name: p.name })));
      } catch (e) {
        // Not fatal — Manual mode doesn't need any of this.
        console.error('[modules/portals]', e);
      } finally {
        setLoadingModules(false);
      }
    })();
  }, [projectId]);

  // Cascading invariants — when a parent changes, child must clear if it no
  // longer matches. (Portal change → drop module if module not under new portal;
  // module change → drop suite if suite not under new module.)
  useEffect(() => {
    if (!moduleIdF) return;
    const m = modules.find(mm => mm.id === moduleIdF);
    if (!m) {
      setModuleIdF('');
      return;
    }
    if (portalIdF && m.portalId !== portalIdF) setModuleIdF('');
  }, [portalIdF, moduleIdF, modules]);

  useEffect(() => {
    if (!suiteIdF) return;
    const owner = modules.find(m => m.suites.some(s => s.id === suiteIdF));
    if (!owner) {
      setSuiteIdF('');
      return;
    }
    if (moduleIdF && owner.id !== moduleIdF) setSuiteIdF('');
    else if (!moduleIdF && portalIdF && owner.portalId !== portalIdF) setSuiteIdF('');
  }, [moduleIdF, portalIdF, suiteIdF, modules]);

  // Filtered option lists — feed the dropdowns. Picking a parent narrows the
  // child list; leaving a parent blank leaves the child fully populated.
  const visibleModules = portalIdF ? modules.filter(m => m.portalId === portalIdF) : modules;
  const visibleSuites = (() => {
    if (moduleIdF) {
      const m = modules.find(mm => mm.id === moduleIdF);
      return m ? m.suites.map(s => ({ ...s, moduleName: m.name })) : [];
    }
    const pool = portalIdF ? visibleModules : modules;
    return pool.flatMap(m => m.suites.map(s => ({ ...s, moduleName: m.name })));
  })();

  // Derived scope — deepest non-empty selection wins.
  const derivedScope: { scopeType: CycleScopeType; scopeId: string | null } = suiteIdF
    ? { scopeType: 'Suite', scopeId: suiteIdF }
    : moduleIdF
      ? { scopeType: 'Module', scopeId: moduleIdF }
      : portalIdF
        ? { scopeType: 'Portal', scopeId: portalIdF }
        : { scopeType: 'All', scopeId: null };

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    // Scope is OPTIONAL — leaving all three dropdowns blank means "All test cases".

    const payload: CycleFormPayload = {
      name: name.trim(),
      description: description.trim() || undefined,
      mode,
      targetDate: targetDate || null,
    };

    if (mode === 'CaseBased') {
      payload.scopeType = derivedScope.scopeType;
      payload.scopeId = derivedScope.scopeId;
      // Optional context that's useful even when running test cases per-case.
      payload.environment = environment || undefined;
      payload.platform = platform || undefined;
      payload.version = version.trim() || undefined;
      payload.ticketLink = ticketLink.trim() || undefined;
    } else {
      payload.moduleName = moduleName.trim() || undefined;
      payload.featureName = featureName.trim() || undefined;
      payload.environment = environment || undefined;
      payload.platform = platform || undefined;
      payload.version = version.trim() || undefined;
      payload.cycleCategory = cycleCategory || undefined;
      payload.ticketLink = ticketLink.trim() || undefined;
      payload.issueCount = issueCount;
      payload.criticalCount = criticalCount;
      payload.majorCount = majorCount;
      payload.minorCount = minorCount;
      payload.doneCount = doneCount;
      payload.remainingCount = remainingCount;
      payload.passedCount = passedCount;
      payload.failedCount = failedCount;
      payload.blockedCount = blockedCount;
    }

    setSubmitting(true);
    try {
      await onSave(payload);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 pb-4 pt-5">
          <h2 className="text-base font-bold text-slate-900">
            {isEdit ? 'Edit cycle' : 'New test run'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Mode toggle — hidden in edit mode (mode is locked) */}
          {!isEdit && (
            <div className="border-b border-slate-100 bg-slate-50 px-6 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Cycle type
              </p>
              <div className="grid grid-cols-2 gap-2">
                <ModeOption
                  active={mode === 'CaseBased'}
                  title="Detailed"
                  desc="Execute each test case one by one (pass / fail / blocked per case)."
                  onClick={() => setMode('CaseBased')}
                />
                <ModeOption
                  active={mode === 'Manual'}
                  title="Quick log"
                  desc="Just record aggregate counts per Module + Feature — no test cases needed."
                  onClick={() => setMode('Manual')}
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4 px-6 py-4">
            {/* Common: name + description */}
            <Field label="Name" required>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={
                  mode === 'Manual'
                    ? 'e.g. Sprint 24 — QR Attendance regression'
                    : 'e.g. Sprint 24 regression'
                }
                className="input"
              />
            </Field>

            {mode === 'Manual' ? (
              <>
                {/* Manual-mode form ───────────────────────────── */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Module">
                    <input
                      type="text"
                      value={moduleName}
                      onChange={e => setModuleName(e.target.value)}
                      placeholder="e.g. Mobile App"
                      className="input"
                      list="cycle-module-suggestions"
                    />
                    <datalist id="cycle-module-suggestions">
                      {modules.map(m => (
                        <option key={m.id} value={m.name} />
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Feature">
                    <input
                      type="text"
                      value={featureName}
                      onChange={e => setFeatureName(e.target.value)}
                      placeholder="e.g. QR Attendance"
                      className="input"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Environment">
                    <SelectWithCustom
                      value={environment}
                      onChange={setEnvironment}
                      options={ENVIRONMENTS}
                      placeholder="Production / QA / …"
                    />
                  </Field>
                  <Field label="Platform">
                    <SelectWithCustom
                      value={platform}
                      onChange={setPlatform}
                      options={PLATFORMS}
                      placeholder="Android / iPhone / Web / All"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Version">
                    <input
                      type="text"
                      value={version}
                      onChange={e => setVersion(e.target.value)}
                      placeholder="v3.5.9"
                      className="input"
                    />
                  </Field>
                  <Field label="Cycle category">
                    <SelectWithCustom
                      value={cycleCategory}
                      onChange={setCycleCategory}
                      options={CYCLE_CATEGORIES}
                      placeholder="Stability / Regression / …"
                    />
                  </Field>
                </div>

                <Field label="Ticket link">
                  <input
                    type="text"
                    value={ticketLink}
                    onChange={e => setTicketLink(e.target.value)}
                    placeholder="NPD-10656 or full URL"
                    className="input"
                  />
                </Field>

                {/* Issue counts */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Issues found
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    <CountField label="Total" value={issueCount} onChange={setIssueCount} />
                    <CountField
                      label="Critical"
                      value={criticalCount}
                      onChange={setCriticalCount}
                      tone="danger"
                    />
                    <CountField
                      label="Major"
                      value={majorCount}
                      onChange={setMajorCount}
                      tone="warning"
                    />
                    <CountField
                      label="Minor"
                      value={minorCount}
                      onChange={setMinorCount}
                      tone="muted"
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <CountField
                      label="Done (resolved)"
                      value={doneCount}
                      onChange={setDoneCount}
                      tone="success"
                    />
                    <CountField
                      label="Remaining (open)"
                      value={remainingCount}
                      onChange={setRemainingCount}
                      tone="danger"
                    />
                  </div>
                </div>

                {/* Test case counts (optional) */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Test case results (optional)
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <CountField
                      label="Passed"
                      value={passedCount}
                      onChange={setPassedCount}
                      tone="success"
                    />
                    <CountField
                      label="Failed"
                      value={failedCount}
                      onChange={setFailedCount}
                      tone="danger"
                    />
                    <CountField
                      label="Blocked"
                      value={blockedCount}
                      onChange={setBlockedCount}
                      tone="warning"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* CaseBased-mode form ──────────────────────── */}
                <Field label="Description">
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    rows={2}
                    placeholder="Optional notes about this cycle…"
                    className="input resize-y"
                  />
                </Field>

                {/* Optional cascading scope — leave any of the three blank and that
                    level is treated as "any". Cycle scope is derived from the deepest
                    non-empty pick (All / Portal / Module / Suite). */}
                <Field label="Scope">
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={portalIdF}
                      onChange={e => setPortalIdF(e.target.value)}
                      disabled={loadingModules}
                      className="input"
                    >
                      <option value="">Any portal</option>
                      {portals.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={moduleIdF}
                      onChange={e => setModuleIdF(e.target.value)}
                      disabled={loadingModules || visibleModules.length === 0}
                      className="input"
                    >
                      <option value="">Any module</option>
                      {visibleModules.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={suiteIdF}
                      onChange={e => setSuiteIdF(e.target.value)}
                      disabled={loadingModules || visibleSuites.length === 0}
                      className="input"
                    >
                      <option value="">Any feature</option>
                      {visibleSuites.map(s => (
                        <option key={s.id} value={s.id}>
                          {moduleIdF ? s.name : `${s.moduleName} — ${s.name}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {derivedScope.scopeType === 'All'
                      ? 'Includes every test case in this workspace.'
                      : derivedScope.scopeType === 'Portal'
                        ? 'Includes every test case under this portal.'
                        : derivedScope.scopeType === 'Module'
                          ? 'Includes every test case under this module (direct + nested features).'
                          : 'Includes only test cases in this feature.'}
                  </p>
                </Field>

                {/* Run context — optional but very useful when sharing the summary. */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Environment">
                    <SelectWithCustom
                      value={environment}
                      onChange={setEnvironment}
                      options={ENVIRONMENTS}
                      placeholder="Production / QA / …"
                    />
                  </Field>
                  <Field label="Platform">
                    <SelectWithCustom
                      value={platform}
                      onChange={setPlatform}
                      options={PLATFORMS}
                      placeholder="Android / iPhone / Web / All"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Version">
                    <input
                      type="text"
                      value={version}
                      onChange={e => setVersion(e.target.value)}
                      placeholder="v3.5.9"
                      className="input"
                    />
                  </Field>
                  <Field label="Ticket link">
                    <input
                      type="text"
                      value={ticketLink}
                      onChange={e => setTicketLink(e.target.value)}
                      placeholder="NPD-10656 or full URL"
                      className="input"
                    />
                  </Field>
                </div>
              </>
            )}

            <Field label="Target date (optional)">
              <input
                type="date"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                className="input"
              />
            </Field>

            {error && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
            {isEdit ? 'Save changes' : mode === 'Manual' ? 'Save quick log' : 'Create cycle'}
          </button>
        </div>
      </div>

      {/* Shared input styling — defined locally so this modal doesn't depend on globals */}
      <style jsx>{`
        :global(.input) {
          @apply w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100;
        }
      `}</style>
    </div>
  );
}

// ─── Small bits ─────────────────────────────────────────────

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
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold text-slate-500">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function ModeOption({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all',
        active
          ? 'border-blue-500 bg-white shadow-sm ring-2 ring-blue-100'
          : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <span
        className={cn('text-[13px] font-semibold', active ? 'text-blue-700' : 'text-slate-700')}
      >
        {title}
      </span>
      <span className="text-[11px] text-slate-500">{desc}</span>
    </button>
  );
}

function SelectWithCustom({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  // Free-text input with datalist suggestions — lets users pick a preset OR type a custom value.
  const id = `dl-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input"
        list={id}
      />
      <datalist id={id}>
        {options.map(o => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

function CountField({
  label,
  value,
  onChange,
  tone,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  tone?: 'success' | 'danger' | 'warning' | 'muted';
}) {
  const tint =
    tone === 'success'
      ? 'text-emerald-700'
      : tone === 'danger'
        ? 'text-red-700'
        : tone === 'warning'
          ? 'text-amber-700'
          : tone === 'muted'
            ? 'text-slate-500'
            : 'text-slate-800';
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <input
        type="number"
        min={0}
        value={value}
        onFocus={e => e.currentTarget.select()}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className={cn(
          'w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-center text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100',
          tint,
        )}
      />
    </label>
  );
}
