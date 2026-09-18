'use client';

import { useEffect, useState } from 'react';
import { CycleScopeType, CycleMode, Module, TestCycle } from '@/types';
import { api } from '@/lib/client';
import { cn, localDateStr } from '@/lib/utils';

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
  testCaseIds?: string[];
  targetDate?: string | null;
  /** When the cycle was actually executed (Manual-mode back-dating). */
  completedAt?: string | null;
  // Manual-mode fields
  portalName?: string;
  moduleName?: string;
  featureName?: string;
  environment?: string;
  platform?: string;
  version?: string;
  cycleCategory?: string;
  ticketLink?: string;
  jiraStatus?: string;
  jiraSyncedAt?: string | null;
  issueCount?: number;
  criticalCount?: number;
  majorCount?: number;
  minorCount?: number;
  doneCount?: number;
  remainingCount?: number;
  reopenedCount?: number;
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
  // Fixed for the modal's lifetime -- which mode you're in is decided by
  // which button opened it (Add Test Run vs Quick Log), not chosen here.
  const mode: CycleMode = initial?.mode ?? defaultMode;

  // ── Core fields ─────────────────────────────────────────────
  const [name, setName] = useState(initial?.name ?? '');
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
  // Versions already used somewhere in this project -- the Version field is
  // a real <select> now, so it needs a real option list rather than letting
  // free text through.
  const [knownVersions, setKnownVersions] = useState<string[]>([]);

  // Read-only preview of how many cases the current scope covers -- mirrors
  // exactly what /api/cycles POST would match, never a value typed in.
  const [caseCount, setCaseCount] = useState<number | null>(null);
  const [caseCountLoading, setCaseCountLoading] = useState(false);

  // ── Manual-mode fields ──────────────────────────────────────
  const [completedOn, setCompletedOn] = useState(() => {
    if (initial?.completedAt) return initial.completedAt.slice(0, 10);
    // Default to today's date for new quick-logs — user can back-date if needed.
    return localDateStr();
  });
  // Free-text names, independent of the structured picker below. Seeded from
  // the existing record so a cycle whose module/feature was set as plain text
  // (e.g. imported data with no matching real Portal/Module row) still shows
  // and keeps its labels on save, instead of the picker silently blanking
  // them out because nothing in the dropdowns happens to match scopeId.
  // Picking from the dropdowns below overwrites these to match the pick.
  const [portalNameFree, setPortalNameFree] = useState(initial?.portalName ?? '');
  const [moduleNameFree, setModuleNameFree] = useState(initial?.moduleName ?? '');
  const [featureNameFree, setFeatureNameFree] = useState(initial?.featureName ?? '');
  const [environment, setEnvironment] = useState(initial?.environment ?? '');
  const [platform, setPlatform] = useState(initial?.platform ?? '');
  const [version, setVersion] = useState(initial?.version ?? '');
  const [cycleCategory, setCycleCategory] = useState(initial?.cycleCategory ?? '');
  const [ticketLink, setTicketLink] = useState(initial?.ticketLink ?? '');
  const [issueCount, setIssueCount] = useState(initial?.issueCount ?? 0);
  const [criticalCount, setCriticalCount] = useState(initial?.criticalCount ?? 0);
  const [majorCount, setMajorCount] = useState(initial?.majorCount ?? 0);
  const [minorCount, setMinorCount] = useState(initial?.minorCount ?? 0);
  // How many of the issues above are resolved vs still open — plain counts
  // the tester fills in directly, most useful when this cycle retests an
  // earlier one, but available any time. Remaining defaults to following
  // Failed (the common case: one failed case = one open issue) until the
  // tester types into Remaining themselves — editing an existing cycle
  // counts as already "touched" so opening it for an unrelated edit never
  // silently overwrites a Remaining value that was saved on purpose.
  const [doneCount, setDoneCount] = useState(initial?.doneCount ?? 0);
  const [remainingCount, setRemainingCount] = useState(initial?.remainingCount ?? 0);
  const [remainingTouched, setRemainingTouched] = useState(initial != null);
  // Of remainingCount, how many regressed after being marked done -- set only
  // by "Sync from Jira" (see lib/jira.ts's isReopened); no manual equivalent.
  const [reopenedCount, setReopenedCount] = useState(initial?.reopenedCount ?? 0);
  const [passedCount, setPassedCount] = useState(initial?.passedCount ?? 0);
  const [failedCount, setFailedCount] = useState(initial?.failedCount ?? 0);
  const [blockedCount, setBlockedCount] = useState(initial?.blockedCount ?? 0);

  // ── Jira sync ────────────────────────────────────────────────
  // The linked ticket's own status + when it was last pulled -- set by
  // "Sync from Jira" below, persisted alongside the counts on save.
  const [jiraStatus, setJiraStatus] = useState(initial?.jiraStatus ?? '');
  const [jiraSyncedAt, setJiraSyncedAt] = useState(initial?.jiraSyncedAt ?? '');
  const [jiraConnected, setJiraConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .get<{ connected: boolean }>(`/api/projects/${projectId}/integrations/jira`)
      .then(s => !cancelled && setJiraConnected(s.connected))
      .catch(() => !cancelled && setJiraConnected(false));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const syncFromJira = async () => {
    if (!projectId || !ticketLink.trim()) return;
    setSyncError('');
    setSyncing(true);
    try {
      const result = await api.post<{
        status: string;
        issueCount: number;
        criticalCount: number;
        majorCount: number;
        minorCount: number;
        doneCount: number;
        remainingCount: number;
        reopenedCount: number;
      }>(`/api/projects/${projectId}/integrations/jira/fetch`, { ticketLink: ticketLink.trim() });
      setJiraStatus(result.status);
      setJiraSyncedAt(new Date().toISOString());
      setIssueCount(result.issueCount);
      setCriticalCount(result.criticalCount);
      setMajorCount(result.majorCount);
      setMinorCount(result.minorCount);
      setDoneCount(result.doneCount);
      setRemainingCount(result.remainingCount);
      setReopenedCount(result.reopenedCount);
      setRemainingTouched(true);
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const handleRemainingChange = (v: number) => {
    setRemainingTouched(true);
    setRemainingCount(v);
  };
  const handleFailedChange = (v: number) => {
    setFailedCount(v);
    if (!remainingTouched) setRemainingCount(v);
  };
  // Total issues follows the same default: freshly-reported issues start
  // out unresolved, so Remaining defaults to matching whichever of Total or
  // Failed was typed most recently — either is a reasonable "nothing's
  // fixed yet" starting point.
  const handleIssueCountChange = (v: number) => {
    setIssueCount(v);
    if (!remainingTouched) setRemainingCount(v);
  };

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const modUrl = projectId ? `/api/modules?projectId=${projectId}` : '/api/modules';
        const [mods, ports, cycles] = await Promise.all([
          api.get<ApiModule[]>(modUrl),
          projectId
            ? api
                .get<{ id: string; name: string }[]>(`/api/portals?projectId=${projectId}`)
                .catch(() => [])
            : Promise.resolve([]),
          projectId
            ? api
                .get<{ version: string | null }[]>(`/api/cycles?projectId=${projectId}`)
                .catch(() => [])
            : Promise.resolve([]),
        ]);
        setModules(mods);
        setPortals(ports.map(p => ({ id: p.id, name: p.name })));
        setKnownVersions(
          Array.from(new Set(cycles.map(c => c.version).filter((v): v is string => !!v))),
        );
      } catch (e) {
        // Not fatal — Manual mode doesn't need any of this.
        console.error('[modules/portals]', e);
      } finally {
        setLoadingModules(false);
      }
    })();
  }, [projectId]);

  // Live count of how many cases the current CaseBased scope matches --
  // same filters /api/cycles POST uses to generate runs, just read-only here.
  useEffect(() => {
    if (mode !== 'CaseBased') return;
    let cancelled = false;
    setCaseCountLoading(true);
    const params = new URLSearchParams({ pageSize: '1' });
    if (suiteIdF) params.set('suiteId', suiteIdF);
    else if (moduleIdF) params.set('moduleId', moduleIdF);
    else if (portalIdF) params.set('portalId', portalIdF);
    else if (projectId) params.set('projectId', projectId);
    api
      .get<{ total: number }>(`/api/test-cases?${params.toString()}`)
      .then(d => {
        if (!cancelled) setCaseCount(d.total);
      })
      .catch(() => {
        if (!cancelled) setCaseCount(null);
      })
      .finally(() => {
        if (!cancelled) setCaseCountLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, portalIdF, moduleIdF, suiteIdF, projectId]);

  // Cascading invariants — when a parent changes, child must clear if it no
  // longer matches. (Portal change → drop module if module not under new portal;
  // module change → drop suite if suite not under new module.)
  // `modules` starts empty until the fetch above resolves — without the
  // `modules.length === 0` guard, this ran on that very first empty render,
  // found no match for a real pre-selected id, and wiped it out before the
  // real list ever loaded. That's what made editing a cycle that WAS linked
  // to a real module/suite look identical to a free-text one: the id was
  // correct in the data, but this effect cleared it out of the form on open.
  useEffect(() => {
    if (!moduleIdF || modules.length === 0) return;
    const m = modules.find(mm => mm.id === moduleIdF);
    if (!m) {
      setModuleIdF('');
      return;
    }
    if (portalIdF && m.portalId !== portalIdF) setModuleIdF('');
  }, [portalIdF, moduleIdF, modules]);

  useEffect(() => {
    if (!suiteIdF || modules.length === 0) return;
    const owner = modules.find(m => m.suites.some(s => s.id === suiteIdF));
    if (!owner) {
      setSuiteIdF('');
      return;
    }
    if (moduleIdF && owner.id !== moduleIdF) setSuiteIdF('');
    else if (!moduleIdF && portalIdF && owner.portalId !== portalIdF) setSuiteIdF('');
  }, [moduleIdF, portalIdF, suiteIdF, modules]);

  // Backfill the parent dropdowns once modules load. The initial state above
  // only seeds the exact level the cycle is scoped to (e.g. a Suite-scoped
  // cycle only sets suiteIdF), so without this a Suite- or Module-scoped
  // cycle shows "No portal" / "No module" on open despite genuinely
  // belonging to real ones. Runs once modules first arrive — `modules`'s
  // reference is then stable, so it won't fight a user's own later choice.
  useEffect(() => {
    if (modules.length === 0) return;
    if (suiteIdF && !moduleIdF) {
      const owner = modules.find(m => m.suites.some(s => s.id === suiteIdF));
      if (owner) {
        setModuleIdF(owner.id);
        if (!portalIdF) setPortalIdF(owner.portalId);
      }
    } else if (moduleIdF && !portalIdF) {
      const m = modules.find(mm => mm.id === moduleIdF);
      if (m) setPortalIdF(m.portalId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules]);

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

  // Total issues must equal the sum of its own severity breakdown — otherwise
  // "Total" and "Critical + Major + Minor" tell two different stories and
  // whichever one feeds a report (Stability, Dashboard) becomes unreliable.
  const severitySum = criticalCount + majorCount + minorCount;
  const severityMismatch =
    mode === 'Manual' && (issueCount > 0 || severitySum > 0) && severitySum !== issueCount;

  // Done/Remaining are optional (untouched = "not tracked yet", the (0, 0)
  // state every report treats as distinct from "fully resolved") — but once
  // either one has actually been filled in, every issue found has to be
  // accounted for as either done or still open, so the two must sum to
  // exactly Total. Without this check the fields accept any numbers at all
  // (e.g. Done 21 + Remaining 22 against a Total of 21), which makes no sense
  // and silently breaks every report that reads them.
  const doneRemainingSum = doneCount + remainingCount;
  const doneRemainingTracked = doneCount > 0 || remainingCount > 0;
  const doneRemainingMismatch =
    mode === 'Manual' && doneRemainingTracked && doneRemainingSum !== issueCount;

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (severityMismatch) {
      setError(
        `Critical + Major + Minor (${severitySum}) must equal Total issues (${issueCount}).`,
      );
      return;
    }
    if (doneRemainingMismatch) {
      setError(`Done + Remaining (${doneRemainingSum}) must equal Total issues (${issueCount}).`);
      return;
    }
    // Scope is OPTIONAL — leaving all three dropdowns blank means "All test cases".

    const payload: CycleFormPayload = {
      name: name.trim(),
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
      payload.cycleCategory = cycleCategory || undefined;
      payload.ticketLink = ticketLink.trim() || undefined;
    } else {
      // Quick-log was executed on `completedOn`. If that's still today, capture
      // the actual moment (not a fabricated midnight) so relative-time displays
      // (Dashboard, Stability report) read correctly for a log just submitted.
      // Only a genuinely back-dated pick is anchored to local midnight instead.
      const chosenDate = completedOn || localDateStr();
      payload.completedAt =
        chosenDate === localDateStr()
          ? new Date().toISOString()
          : new Date(`${chosenDate}T00:00:00`).toISOString();
      // Structured location, shared with Detailed mode's cascading picker —
      // this is what lets the Stability report join a quick log to a real
      // module/feature instead of matching on free text.
      payload.scopeType = derivedScope.scopeType;
      payload.scopeId = derivedScope.scopeId;
      // Free-text names: kept in sync with the picker when the user actually
      // picks something (see the selects' onChange above), but otherwise left
      // as whatever was already saved — so a record whose module/feature was
      // set as plain text keeps it instead of the picker silently blanking it.
      payload.portalName = portalNameFree || undefined;
      payload.moduleName = moduleNameFree || undefined;
      payload.featureName = featureNameFree || undefined;
      payload.environment = environment || undefined;
      payload.platform = platform || undefined;
      payload.version = version.trim() || undefined;
      payload.cycleCategory = cycleCategory || undefined;
      payload.ticketLink = ticketLink.trim() || undefined;
      payload.jiraStatus = jiraStatus || undefined;
      payload.jiraSyncedAt = jiraSyncedAt || undefined;
      payload.issueCount = issueCount;
      payload.criticalCount = criticalCount;
      payload.majorCount = majorCount;
      payload.minorCount = minorCount;
      payload.doneCount = doneCount;
      payload.remainingCount = remainingCount;
      payload.reopenedCount = reopenedCount;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold text-text">
            {isEdit ? `Edit ${initial?.name}` : 'New Test Cycle'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <i className="ti ti-x text-[16px]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-5 py-4">
            {mode === 'Manual' ? (
              <>
                {/* Manual-mode form ─────────────────────────────
                    Location uses the SAME cascading Portal→Module→Feature picker
                    as Detailed runs (shared portalIdF/moduleIdF/suiteIdF state +
                    derivedScope below) — this is what makes module/feature
                    stability tracking possible for quick logs: the log is tied to
                    a real record, not a free-text string that can typo/drift. */}
                <Field label="Name" required>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Sprint 24 — QR Attendance regression"
                    className="input"
                  />
                </Field>

                <Field label="Completed on" required>
                  <input
                    type="date"
                    value={completedOn}
                    onChange={e => setCompletedOn(e.target.value)}
                    max={localDateStr()}
                    className="input"
                  />
                  <p className="mt-1 text-[11px] text-text-3">
                    Back-date a cycle you ran earlier; defaults to today.
                  </p>
                </Field>

                <Field label="Where does this apply?">
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={portalIdF}
                      onChange={e => {
                        setPortalIdF(e.target.value);
                        setPortalNameFree(portals.find(p => p.id === e.target.value)?.name ?? '');
                      }}
                      disabled={loadingModules}
                      className="input"
                    >
                      <option value="">No portal</option>
                      {portals.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={moduleIdF}
                      onChange={e => {
                        setModuleIdF(e.target.value);
                        setModuleNameFree(
                          visibleModules.find(m => m.id === e.target.value)?.name ?? '',
                        );
                      }}
                      disabled={loadingModules || visibleModules.length === 0}
                      className="input"
                    >
                      <option value="">No module</option>
                      {visibleModules.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={suiteIdF}
                      onChange={e => {
                        setSuiteIdF(e.target.value);
                        setFeatureNameFree(
                          visibleSuites.find(s => s.id === e.target.value)?.name ?? '',
                        );
                      }}
                      disabled={loadingModules || visibleSuites.length === 0}
                      className="input"
                    >
                      <option value="">No feature</option>
                      {visibleSuites.map(s => (
                        <option key={s.id} value={s.id}>
                          {moduleIdF ? s.name : `${s.moduleName} — ${s.name}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  {isEdit &&
                    !portalIdF &&
                    !moduleIdF &&
                    !suiteIdF &&
                    (portalNameFree || moduleNameFree || featureNameFree) && (
                      <p className="mt-1.5 text-[11px] text-amber-600">
                        Currently saved as free text —{' '}
                        {[portalNameFree, moduleNameFree, featureNameFree]
                          .filter(Boolean)
                          .join(' / ')}
                        . Pick a real location above to link it to the Stability report, or leave
                        as-is to keep the text.
                      </p>
                    )}
                  <p className="mt-1.5 text-[11px] text-text-3">
                    Picking a module or feature here feeds the Stability report — it counts this log
                    toward that module/feature&apos;s rolling pass rate.
                  </p>
                </Field>

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
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={ticketLink}
                      onChange={e => setTicketLink(e.target.value)}
                      placeholder="NPD-10656 or full URL"
                      className="input flex-1"
                    />
                    {jiraConnected && (
                      <button
                        type="button"
                        disabled={!ticketLink.trim() || syncing}
                        onClick={syncFromJira}
                        className="flex-shrink-0 whitespace-nowrap rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {syncing ? (
                          <i className="ti ti-loader-2 animate-spin text-[13px]" />
                        ) : (
                          'Sync from Jira'
                        )}
                      </button>
                    )}
                  </div>
                  {syncError && (
                    <p className="mt-1 text-[11px] font-medium text-danger">{syncError}</p>
                  )}
                  {jiraStatus && (
                    <p className="mt-1 text-[11px] text-text-3">
                      Jira status: <span className="font-medium text-text-2">{jiraStatus}</span>
                      {jiraSyncedAt && ` · synced ${new Date(jiraSyncedAt).toLocaleString()}`}
                    </p>
                  )}
                </Field>

                {/* Issue counts */}
                <div className="rounded-lg border border-border bg-surface-2 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-2">
                    Issues found
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    <CountField
                      label="Total"
                      value={issueCount}
                      onChange={handleIssueCountChange}
                    />
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
                  {severityMismatch && (
                    <p className="mt-1.5 text-[11px] font-medium text-danger">
                      Critical + Major + Minor ({severitySum}) must equal Total ({issueCount}).
                    </p>
                  )}

                  {/* Resolution — optional. To record a retest, come back and
                      edit THIS SAME cycle with fresh Done / Remaining numbers
                      rather than logging a new one. */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border pt-2.5">
                    <CountField
                      label="Done"
                      value={doneCount}
                      onChange={setDoneCount}
                      tone="success"
                    />
                    <CountField
                      label="Remaining"
                      value={remainingCount}
                      onChange={handleRemainingChange}
                      tone="danger"
                    />
                  </div>
                  {doneRemainingMismatch && (
                    <p className="mt-1.5 text-[11px] font-medium text-danger">
                      Done + Remaining ({doneRemainingSum}) must equal Total ({issueCount}).
                    </p>
                  )}
                </div>

                {/* Test case counts (optional) */}
                <div className="rounded-lg border border-border bg-surface-2 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-2">
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
                      onChange={handleFailedChange}
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
                <p className="text-[12px] font-medium text-text-2">Basics</p>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cycle Name" required>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. Sprint 24 regression"
                      className="input"
                    />
                  </Field>
                  <Field label="Cycle Type">
                    <select
                      value={cycleCategory}
                      onChange={e => setCycleCategory(e.target.value)}
                      className="input"
                    >
                      <option value="">Select type…</option>
                      {cycleCategory && !CYCLE_CATEGORIES.includes(cycleCategory) && (
                        <option value={cycleCategory}>{cycleCategory}</option>
                      )}
                      {CYCLE_CATEGORIES.map(c => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Version">
                    <select
                      value={version}
                      onChange={e => setVersion(e.target.value)}
                      className="input"
                    >
                      <option value="">Select version…</option>
                      {/* The current value always gets an option, even if it isn't
                          in knownVersions yet — a real <select> silently blanks out
                          otherwise, which would look like the saved version vanished. */}
                      {version && !knownVersions.includes(version) && (
                        <option value={version}>{version}</option>
                      )}
                      {knownVersions.map(v => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Environment">
                    <select
                      value={environment}
                      onChange={e => setEnvironment(e.target.value)}
                      className="input"
                    >
                      <option value="">Select environment…</option>
                      {environment && !ENVIRONMENTS.includes(environment) && (
                        <option value={environment}>{environment}</option>
                      )}
                      {ENVIRONMENTS.map(e => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="Platform">
                  <select
                    value={platform}
                    onChange={e => setPlatform(e.target.value)}
                    className="input"
                  >
                    <option value="">Select platform…</option>
                    {platform && !PLATFORMS.includes(platform) && (
                      <option value={platform}>{platform}</option>
                    )}
                    {PLATFORMS.map(p => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* Scope — three independent, optional selects. The deepest
                    non-empty pick wins (suite > module > portal > All). */}
                <p className="mt-1 text-[12px] font-medium text-text-2">Scope</p>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Portal">
                    <select
                      value={portalIdF}
                      onChange={e => setPortalIdF(e.target.value)}
                      disabled={loadingModules}
                      className="input"
                    >
                      <option value="">Select Portal…</option>
                      {portals.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Module">
                    <select
                      value={moduleIdF}
                      onChange={e => setModuleIdF(e.target.value)}
                      disabled={loadingModules || visibleModules.length === 0}
                      className="input"
                    >
                      <option value="">Select Module…</option>
                      {visibleModules.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Suite">
                    <select
                      value={suiteIdF}
                      onChange={e => setSuiteIdF(e.target.value)}
                      disabled={loadingModules || visibleSuites.length === 0}
                      className="input"
                    >
                      <option value="">Select Suite…</option>
                      {visibleSuites.map(s => (
                        <option key={s.id} value={s.id}>
                          {moduleIdF ? s.name : `${s.moduleName} › ${s.name}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <p className="text-[11px] text-text-3">
                  {derivedScope.scopeType === 'All'
                    ? 'Includes every test case in this workspace.'
                    : derivedScope.scopeType === 'Portal'
                      ? 'Includes every test case under this portal.'
                      : derivedScope.scopeType === 'Module'
                        ? 'Includes every test case under this module (direct + nested suites).'
                        : 'Includes every test case under this suite.'}
                </p>

                <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-[12.5px]">
                  <span className="text-text-2">Total Test Cases</span>
                  <span className="font-semibold text-text">
                    {caseCountLoading ? 'Counting…' : (caseCount ?? '—')}
                  </span>
                </div>

                <p className="mt-1 text-[12px] font-medium text-text-2">Schedule &amp; Tracking</p>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start Date">
                    <div className="input flex items-center bg-surface-2">
                      {initial ? initial.createdAt.slice(0, 10) : localDateStr()}
                    </div>
                  </Field>
                  <Field label="End Date">
                    <input
                      type="date"
                      value={targetDate}
                      onChange={e => setTargetDate(e.target.value)}
                      className="input"
                    />
                  </Field>
                </div>

                <Field label="Jira ticket link (optional)">
                  <input
                    type="text"
                    value={ticketLink}
                    onChange={e => setTicketLink(e.target.value)}
                    placeholder="JIRA-1234 or a full URL"
                    className="input"
                  />
                </Field>
                <p className="-mt-2 text-[11px] text-text-3">
                  Points out to your tracker — Simplitest doesn&apos;t manage a ticket workflow.
                </p>
              </>
            )}

            {mode === 'Manual' && (
              <Field label="Target date (optional)">
                <input
                  type="date"
                  value={targetDate}
                  onChange={e => setTargetDate(e.target.value)}
                  className="input"
                />
              </Field>
            )}

            {error && <p className="text-[12px] text-danger">{error}</p>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-[7px] border border-border bg-surface px-3.5 py-1.5 text-[13px] text-text transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || severityMismatch || doneRemainingMismatch}
            title={
              severityMismatch
                ? 'Fix the issue count mismatch before saving'
                : doneRemainingMismatch
                  ? 'Fix the Done/Remaining mismatch before saving'
                  : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i
              className={cn(
                'ti text-[13px]',
                submitting ? 'ti-loader-2 animate-spin' : isEdit ? 'ti-check' : 'ti-plus',
              )}
            />
            {isEdit ? 'Save Changes' : mode === 'Manual' ? 'Save Quick Log' : 'Create Cycle'}
          </button>
        </div>
      </div>

      {/* Shared input styling — defined locally so this modal doesn't depend on globals */}
      <style jsx>{`
        :global(.input) {
          @apply w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light;
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
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <p className="mb-1 text-[12px] font-medium text-text-2">
        {label} {required && <span className="text-danger">*</span>}
      </p>
      {children}
    </div>
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
        ? 'text-danger'
        : tone === 'warning'
          ? 'text-amber-700'
          : tone === 'muted'
            ? 'text-text-3'
            : 'text-text';
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-text-3">{label}</span>
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
          'w-full rounded-md border border-border bg-surface px-2 py-1 text-center text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary-light',
          tint,
        )}
      />
    </label>
  );
}
