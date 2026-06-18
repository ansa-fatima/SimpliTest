'use client';

import { useEffect, useState } from 'react';
import { CycleScopeType, CycleMode, Module, TestCycle } from '@/types';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

interface ApiModule {
  id: string;
  name: string;
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
  const [scopeType, setScopeType] = useState<CycleScopeType>(initial?.scopeType ?? 'All');
  const [scopeId, setScopeId] = useState<string>(initial?.scopeId ?? '');
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

  // Reset scopeId to a valid value when scopeType or modules change.
  useEffect(() => {
    if (mode !== 'CaseBased') return;
    if (scopeType === 'Portal') {
      const first = portals[0];
      setScopeId(prev => (portals.some(p => p.id === prev) ? prev : (first?.id ?? '')));
    } else if (scopeType === 'Module') {
      const first = modules[0];
      setScopeId(prev => (modules.some(m => m.id === prev) ? prev : (first?.id ?? '')));
    } else if (scopeType === 'Suite') {
      const all = modules.flatMap(m => m.suites);
      const first = all[0];
      setScopeId(prev => (all.some(s => s.id === prev) ? prev : (first?.id ?? '')));
    } else {
      setScopeId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeType, modules, portals, mode]);

  const suites =
    scopeType === 'Suite'
      ? modules.flatMap(m => m.suites.map(s => ({ ...s, moduleName: m.name })))
      : [];

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (
      mode === 'CaseBased' &&
      (scopeType === 'Portal' || scopeType === 'Module' || scopeType === 'Suite') &&
      !scopeId
    ) {
      setError(`Pick a ${scopeType.toLowerCase()}`);
      return;
    }

    const payload: CycleFormPayload = {
      name: name.trim(),
      description: description.trim() || undefined,
      mode,
      targetDate: targetDate || null,
    };

    if (mode === 'CaseBased') {
      payload.scopeType = scopeType;
      payload.scopeId =
        scopeType === 'Portal' || scopeType === 'Module' || scopeType === 'Suite' ? scopeId : null;
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

                <Field label="Scope" required>
                  <div className="flex flex-wrap gap-1.5">
                    {(['All', 'Portal', 'Module', 'Suite'] as CycleScopeType[]).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setScopeType(t)}
                        className={cn(
                          'cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition-all',
                          scopeType === t
                            ? 'border-blue-500 bg-indigo-50 font-semibold text-blue-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                        )}
                      >
                        {t === 'All' ? 'All test cases' : t}
                      </button>
                    ))}
                  </div>
                </Field>

                {scopeType === 'Portal' && (
                  <Field label="Pick portal">
                    {loadingModules ? (
                      <span className="text-xs text-slate-400">Loading…</span>
                    ) : portals.length === 0 ? (
                      <span className="text-xs italic text-slate-400">
                        No portals in this workspace yet.
                      </span>
                    ) : (
                      <select
                        value={scopeId}
                        onChange={e => setScopeId(e.target.value)}
                        className="input"
                      >
                        {portals.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}

                {scopeType === 'Module' && (
                  <Field label="Pick module">
                    {loadingModules ? (
                      <span className="text-xs text-slate-400">Loading…</span>
                    ) : modules.length === 0 ? (
                      <span className="text-xs italic text-slate-400">
                        No modules in this workspace yet.
                      </span>
                    ) : (
                      <select
                        value={scopeId}
                        onChange={e => setScopeId(e.target.value)}
                        className="input"
                      >
                        {modules.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}

                {scopeType === 'Suite' && (
                  <Field label="Pick suite">
                    {loadingModules ? (
                      <span className="text-xs text-slate-400">Loading…</span>
                    ) : suites.length === 0 ? (
                      <span className="text-xs italic text-slate-400">
                        No suites yet — add some from Test Cases first.
                      </span>
                    ) : (
                      <select
                        value={scopeId}
                        onChange={e => setScopeId(e.target.value)}
                        className="input"
                      >
                        {suites.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.moduleName} — {s.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}

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
