'use client';

import { useEffect, useState } from 'react';
import { CycleScopeType, TestCycle } from '@/types';
import { api } from '@/lib/client';
import { cn, localDateStr } from '@/lib/utils';
import { CycleFormPayload } from './NewCycleModal';
import { JiraTicketLink, useJiraSiteUrl } from '@/lib/jiraLink';
import type { JiraSubIssueInfo } from '@/lib/jira';

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

const ENVIRONMENTS = ['Production', 'QA', 'Staging', 'Dev'];
const PLATFORMS = ['Android', 'iPhone', 'Web', 'All', 'Desktop'];
const CATEGORIES = ['Stability', 'Regression', 'Functional', 'UI', 'Performance', 'Smoke'];

const inputCls =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light';

// ─── New Quick Log ──────────────────────────────────────────

interface NewQuickLogModalProps {
  projectId: string | null;
  /** Distinct version strings already used in this workspace, for the App Version suggestions. */
  knownVersions: string[];
  onClose: () => void;
  onSave: (input: CycleFormPayload) => Promise<void>;
}

// A fast, focused "what did you find" form -- deliberately not the full
// cycle-creation modal (no name field, no back-dating): a quick log is
// meant to take 30 seconds, and the name/date derive themselves from what
// you pick below.
export function NewQuickLogModal({
  projectId,
  knownVersions,
  onClose,
  onSave,
}: NewQuickLogModalProps) {
  const [modules, setModules] = useState<ApiModule[]>([]);
  const [portals, setPortals] = useState<ApiPortal[]>([]);
  const [portalId, setPortalId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [suiteName, setSuiteName] = useState('');
  const [critical, setCritical] = useState(0);
  const [major, setMajor] = useState(0);
  const [minor, setMinor] = useState(0);
  const [environment, setEnvironment] = useState('');
  const [platform, setPlatform] = useState('');
  const [version, setVersion] = useState('');
  const [category, setCategory] = useState('');
  const [ticketLink, setTicketLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // ── Jira sync ────────────────────────────────────────────────
  const siteUrl = useJiraSiteUrl(projectId);
  const jiraConnected = siteUrl !== null;
  const [jiraStatus, setJiraStatus] = useState('');
  const [jiraDone, setJiraDone] = useState<number | null>(null);
  const [jiraRemaining, setJiraRemaining] = useState<number | null>(null);
  const [jiraReopened, setJiraReopened] = useState<number | null>(null);
  const [jiraSiteUrl, setJiraSiteUrl] = useState('');
  const [jiraSubIssues, setJiraSubIssues] = useState<JiraSubIssueInfo[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    const modUrl = projectId ? `/api/modules?projectId=${projectId}` : '/api/modules';
    api
      .get<ApiModule[]>(modUrl)
      .then(setModules)
      .catch(() => {});
    if (projectId) {
      api
        .get<ApiPortal[]>(`/api/portals?projectId=${projectId}`)
        .then(setPortals)
        .catch(() => {});
    }
  }, [projectId]);

  const syncFromJira = async () => {
    if (!projectId || !ticketLink.trim()) return;
    setSyncError('');
    setSyncing(true);
    try {
      const result = await api.post<{
        status: string;
        criticalCount: number;
        majorCount: number;
        minorCount: number;
        doneCount: number;
        remainingCount: number;
        reopenedCount: number;
        siteUrl: string;
        subIssues: JiraSubIssueInfo[];
      }>(`/api/projects/${projectId}/integrations/jira/fetch`, { ticketLink: ticketLink.trim() });
      setJiraStatus(result.status);
      setCritical(result.criticalCount);
      setMajor(result.majorCount);
      setMinor(result.minorCount);
      setJiraDone(result.doneCount);
      setJiraRemaining(result.remainingCount);
      setJiraReopened(result.reopenedCount);
      setJiraSiteUrl(result.siteUrl);
      setJiraSubIssues(result.subIssues);
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const selectedModule = modules.find(m => m.id === moduleId) ?? null;
  const selectedPortal = portals.find(p => p.id === portalId) ?? null;
  const visibleModules = portalId ? modules.filter(m => m.portalId === portalId) : modules;
  const total = critical + major + minor;

  const submit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const moduleName = selectedModule?.name ?? '';
      const portalName = selectedPortal?.name ?? '';
      const name = [moduleName, suiteName.trim()].filter(Boolean).join(' → ') || 'Quick log';
      await onSave({
        name,
        mode: 'Manual',
        completedAt: new Date().toISOString(),
        scopeType: moduleId ? 'Module' : 'All',
        scopeId: moduleId || null,
        portalName: portalName || undefined,
        moduleName: moduleName || undefined,
        featureName: suiteName.trim() || undefined,
        environment: environment || undefined,
        platform: platform || undefined,
        version: version.trim() || undefined,
        cycleCategory: category || undefined,
        ticketLink: ticketLink.trim() || undefined,
        jiraStatus: jiraStatus || undefined,
        jiraSyncedAt: jiraStatus ? new Date().toISOString() : undefined,
        jiraSiteUrl: jiraSiteUrl || undefined,
        jiraSubIssues: jiraSubIssues.length > 0 ? jiraSubIssues : undefined,
        issueCount: total,
        criticalCount: critical,
        majorCount: major,
        minorCount: minor,
        doneCount: jiraDone ?? undefined,
        remainingCount: jiraRemaining ?? undefined,
        reopenedCount: jiraReopened ?? undefined,
      });
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-[520px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold text-text">New Quick Log</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <i className="ti ti-x text-[16px]" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-text-2">Where did this happen?</p>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={portalId}
                onChange={e => {
                  setPortalId(e.target.value);
                  setModuleId('');
                }}
                className={inputCls}
              >
                <option value="">Portal…</option>
                {portals.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={moduleId}
                onChange={e => {
                  const id = e.target.value;
                  setModuleId(id);
                  if (!portalId) {
                    const m = modules.find(mm => mm.id === id);
                    if (m) setPortalId(m.portalId);
                  }
                }}
                className={inputCls}
              >
                <option value="">Module…</option>
                {visibleModules.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <SuiteInput
                value={suiteName}
                onChange={setSuiteName}
                suites={selectedModule?.suites ?? []}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-text-3">
              Suite doesn&apos;t need to exist in the hierarchy yet — pick from the list or type a
              new one, you&apos;re never blocked from logging.
            </p>
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium text-text-2">What did you find?</p>
            <div className="grid grid-cols-3 gap-2">
              <Counter label="Critical" tone="danger" value={critical} onChange={setCritical} />
              <Counter label="Major" tone="warning" value={major} onChange={setMajor} />
              <Counter label="Minor" tone="muted" value={minor} onChange={setMinor} />
            </div>
            <div className="mt-2 flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-[12.5px]">
              <span className="text-text-2">Total issues</span>
              <span className="font-semibold text-text">{total}</span>
            </div>
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
                placeholder="Android / iPhone / Web"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="App Version">
              <SelectWithCustom
                value={version}
                onChange={setVersion}
                options={knownVersions}
                placeholder="v3.8.0"
              />
            </Field>
            <Field label="Category">
              <SelectWithCustom
                value={category}
                onChange={setCategory}
                options={CATEGORIES}
                placeholder="Stability / Regression / …"
              />
            </Field>
          </div>

          <Field label="Ticket link (optional)">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ticketLink}
                onChange={e => {
                  setTicketLink(e.target.value);
                  setJiraStatus('');
                }}
                placeholder="e.g. JIRA-1234"
                className={cn(inputCls, 'flex-1')}
              />
              {jiraConnected && (
                <button
                  type="button"
                  disabled={!ticketLink.trim() || syncing}
                  onClick={syncFromJira}
                  className="flex-shrink-0 whitespace-nowrap rounded-[7px] border border-border bg-surface px-3 py-2 text-[12px] font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {syncing ? (
                    <i className="ti ti-loader-2 animate-spin text-[13px]" />
                  ) : (
                    'Sync from Jira'
                  )}
                </button>
              )}
            </div>
            {syncError && <p className="mt-1 text-[11px] font-medium text-danger">{syncError}</p>}
            {jiraStatus && (
              <p className="mt-1 text-[11px] text-text-3">
                Jira status: <span className="font-medium text-text-2">{jiraStatus}</span> —
                Critical/Major/Minor filled in below
              </p>
            )}
          </Field>

          {error && <p className="text-[12px] text-danger">{error}</p>}
        </div>

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
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
            <i className="ti ti-check text-[14px]" />
            Log it
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Update Quick Log / Test Cycle (edit) ────────────────────

interface UpdateQuickLogModalProps {
  log: TestCycle;
  projectId: string | null;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}

// The one modal every screen converges on when editing an existing cycle --
// Manual quick log or CaseBased test run alike (Test Runs board, Test
// Cycles listing, and the Dashboard/Stability drilldown's summary-modal
// Edit button all open this same component, instead of each screen opening
// a differently-shaped edit form). Name/Description/Environment/Platform/
// Version/Category/Ticket link are editable either way; the Portal/Module/
// Feature picker is Manual-only, since a CaseBased cycle's scope is fixed
// once its runs are generated -- changing it here wouldn't regenerate them
// (see NewCycleModal's identical note). Issue counts stay read-only unless
// a "Sync from Jira" pulls fresh ones from the linked ticket.
export function UpdateQuickLogModal({ log, projectId, onClose, onSave }: UpdateQuickLogModalProps) {
  const isManual = (log.mode ?? 'CaseBased') === 'Manual';

  // ── Record fields (Name/Description always editable; the rest of the
  // location + detail fields below) ──────────────────────────
  const [name, setName] = useState(log.name);
  const [description, setDescription] = useState(log.description ?? '');
  const [environment, setEnvironment] = useState(log.environment ?? '');
  const [platform, setPlatform] = useState(log.platform ?? '');
  const [version, setVersion] = useState(log.version ?? '');
  const [cycleCategory, setCycleCategory] = useState(log.cycleCategory ?? '');

  // Manual-only location picker, seeded from the existing scope once modules
  // load (mirrors NewCycleModal's own backfill for the same reason: a Suite-
  // scoped log only carries its own id up front).
  const [modules, setModules] = useState<ApiModule[]>([]);
  const [portals, setPortals] = useState<ApiPortal[]>([]);
  const [portalIdF, setPortalIdF] = useState('');
  const [moduleIdF, setModuleIdF] = useState('');
  const [suiteIdF, setSuiteIdF] = useState('');
  const [portalNameFree, setPortalNameFree] = useState(log.portalName ?? '');
  const [moduleNameFree, setModuleNameFree] = useState(log.moduleName ?? '');
  const [featureNameFree, setFeatureNameFree] = useState(log.featureName ?? '');

  useEffect(() => {
    if (!isManual) return;
    api
      .get<ApiModule[]>(projectId ? `/api/modules?projectId=${projectId}` : '/api/modules')
      .then(setModules)
      .catch(() => {});
    if (projectId) {
      api
        .get<ApiPortal[]>(`/api/portals?projectId=${projectId}`)
        .then(setPortals)
        .catch(() => {});
    }
  }, [isManual, projectId]);

  useEffect(() => {
    if (modules.length === 0 || !log.scopeId) return;
    if (log.scopeType === 'Suite') {
      const owner = modules.find(m => m.suites.some(s => s.id === log.scopeId));
      if (owner) {
        setSuiteIdF(log.scopeId);
        setModuleIdF(owner.id);
        setPortalIdF(owner.portalId);
      }
    } else if (log.scopeType === 'Module') {
      const m = modules.find(mm => mm.id === log.scopeId);
      if (m) {
        setModuleIdF(log.scopeId);
        setPortalIdF(m.portalId);
      }
    } else if (log.scopeType === 'Portal') {
      setPortalIdF(log.scopeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules]);

  const visibleModules = portalIdF ? modules.filter(m => m.portalId === portalIdF) : modules;
  const visibleSuites = (() => {
    if (moduleIdF) {
      const m = modules.find(mm => mm.id === moduleIdF);
      return m ? m.suites.map(s => ({ ...s, moduleName: m.name })) : [];
    }
    const pool = portalIdF ? visibleModules : modules;
    return pool.flatMap(m => m.suites.map(s => ({ ...s, moduleName: m.name })));
  })();
  const derivedScope: { scopeType: CycleScopeType; scopeId: string | null } = suiteIdF
    ? { scopeType: 'Suite', scopeId: suiteIdF }
    : moduleIdF
      ? { scopeType: 'Module', scopeId: moduleIdF }
      : portalIdF
        ? { scopeType: 'Portal', scopeId: portalIdF }
        : { scopeType: 'All', scopeId: null };

  // ── Issue-resolution tracking (unchanged for either mode) ───
  const wasTracked = (log.doneCount ?? 0) > 0 || (log.remainingCount ?? 0) > 0;
  const [done, setDone] = useState(wasTracked ? (log.doneCount ?? 0) : 0);
  const [issueCount, setIssueCount] = useState(log.issueCount ?? 0);
  const [critical, setCritical] = useState(log.criticalCount ?? 0);
  const [major, setMajor] = useState(log.majorCount ?? 0);
  const [minor, setMinor] = useState(log.minorCount ?? 0);
  const [ticketLink, setTicketLink] = useState(log.ticketLink ?? '');
  const [jiraStatus, setJiraStatus] = useState(log.jiraStatus ?? '');
  const [jiraSyncedAt, setJiraSyncedAt] = useState(log.jiraSyncedAt ?? '');
  const [jiraSiteUrl, setJiraSiteUrl] = useState(log.jiraSiteUrl ?? '');
  const [reopenedCount, setReopenedCount] = useState(log.reopenedCount ?? 0);
  const [jiraSubIssues, setJiraSubIssues] = useState<JiraSubIssueInfo[]>([]);
  const [synced, setSynced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const siteUrl = useJiraSiteUrl(projectId);
  const jiraConnected = siteUrl !== null;
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  const syncFromJira = async () => {
    if (!projectId || !ticketLink.trim()) return;
    setSyncError('');
    setSyncing(true);
    try {
      const result = await api.post<{
        title: string;
        status: string;
        issueCount: number;
        criticalCount: number;
        majorCount: number;
        minorCount: number;
        doneCount: number;
        remainingCount: number;
        reopenedCount: number;
        siteUrl: string;
        subIssues: JiraSubIssueInfo[];
      }>(`/api/projects/${projectId}/integrations/jira/fetch`, { ticketLink: ticketLink.trim() });
      // Auto-fills the Name field from the parent ticket's own title -- Name
      // stays a normal editable field either way, so typing over it (before
      // or after a sync) always works too.
      if (result.title) setName(result.title);
      setJiraStatus(result.status);
      setJiraSyncedAt(new Date().toISOString());
      setJiraSiteUrl(result.siteUrl);
      setIssueCount(result.issueCount);
      setCritical(result.criticalCount);
      setMajor(result.majorCount);
      setMinor(result.minorCount);
      setDone(result.doneCount);
      setReopenedCount(result.reopenedCount);
      setJiraSubIssues(result.subIssues);
      setSynced(true);
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const remaining = Math.max(0, issueCount - done);
  const percent = issueCount === 0 ? 0 : Math.round((done / issueCount) * 100);
  const code = `${isManual ? 'QL' : 'C'}-${log.id.slice(-4).toUpperCase()}`;
  const scopePath =
    [log.portalName, log.moduleName, log.featureName].filter(Boolean).join(' › ') || 'Unscoped';

  const severities: { label: string; value: number; dot: string; text: string }[] = [
    { label: 'Critical', value: critical, dot: 'bg-danger', text: 'text-danger' },
    { label: 'Major', value: major, dot: 'bg-warning', text: 'text-warning' },
    { label: 'Minor', value: minor, dot: 'bg-text-3', text: 'text-text-2' },
  ].filter(s => s.value > 0);

  const submit = async () => {
    setError('');
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSubmitting(true);
    try {
      const patch: Record<string, unknown> = {
        name: name.trim(),
        description,
        environment: environment || null,
        platform: platform || null,
        version: version.trim() || null,
        cycleCategory: cycleCategory || null,
        ticketLink: ticketLink.trim() || null,
        doneCount: done,
        remainingCount: remaining,
      };
      // Scope/location reassignment only applies to Manual -- a CaseBased
      // cycle's scope is fixed once its runs are generated (see this
      // component's own note above).
      if (isManual) {
        patch.scopeType = derivedScope.scopeType;
        patch.scopeId = derivedScope.scopeId;
        patch.portalName = portalNameFree || null;
        patch.moduleName = moduleNameFree || null;
        patch.featureName = featureNameFree || null;
      }
      if (synced) {
        patch.issueCount = issueCount;
        patch.criticalCount = critical;
        patch.majorCount = major;
        patch.minorCount = minor;
        patch.jiraStatus = jiraStatus;
        patch.jiraSyncedAt = jiraSyncedAt;
        patch.jiraSiteUrl = jiraSiteUrl;
        patch.reopenedCount = reopenedCount;
        patch.jiraSubIssues = jiraSubIssues;
      }
      await onSave(patch);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-[540px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Name"
              className="w-full truncate bg-transparent text-[15px] font-semibold text-text outline-none focus:underline"
            />
            <p className="font-mono text-[10.5px] text-text-3">{code}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <i className="ti ti-x text-[16px]" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          <Field label="Description">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What this cycle covers, notes for next time…"
              rows={2}
              className={cn(inputCls, 'resize-none')}
            />
          </Field>

          <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-3">
            {isManual ? (
              <>
                <p className="mb-1.5 text-[12px] font-medium text-text-2">Where does this apply?</p>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={portalIdF}
                    onChange={e => {
                      setPortalIdF(e.target.value);
                      setPortalNameFree(portals.find(p => p.id === e.target.value)?.name ?? '');
                    }}
                    className={inputCls}
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
                    disabled={visibleModules.length === 0}
                    className={inputCls}
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
                    disabled={visibleSuites.length === 0}
                    className={inputCls}
                  >
                    <option value="">No feature</option>
                    {visibleSuites.map(s => (
                      <option key={s.id} value={s.id}>
                        {moduleIdF ? s.name : `${s.moduleName} — ${s.name}`}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <p className="text-[13.5px] font-semibold text-text">{scopePath}</p>
            )}
            <p className="mt-2 text-[11.5px] text-text-3">
              {localDateStr(new Date(log.createdAt))} · logged by {log.loggedBy || 'Unattributed'}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
              <SelectWithCustom
                value={environment}
                onChange={setEnvironment}
                options={ENVIRONMENTS}
                placeholder="Environment"
              />
              <SelectWithCustom
                value={platform}
                onChange={setPlatform}
                options={PLATFORMS}
                placeholder="Platform"
              />
              <SelectWithCustom
                value={version}
                onChange={setVersion}
                options={[]}
                placeholder="Version, e.g. v3.8.0"
              />
              <SelectWithCustom
                value={cycleCategory}
                onChange={setCycleCategory}
                options={CATEGORIES}
                placeholder="Category"
              />
            </div>

            <p className="mt-3 text-[11.5px] text-text-3">
              {issueCount} issue{issueCount === 1 ? '' : 's'}{' '}
              {synced ? 'found' : 'originally found'}
            </p>
            {severities.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {severities.map(s => (
                  <span
                    key={s.label}
                    className={cn(
                      'inline-flex items-center gap-1.5 text-[12px] font-medium',
                      s.text,
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', s.dot)} />
                    {s.value} {s.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          <Field label="Ticket link">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ticketLink}
                onChange={e => setTicketLink(e.target.value)}
                placeholder="NPD-10656 or full URL"
                className={cn(inputCls, 'flex-1')}
              />
              {jiraConnected && (
                <button
                  type="button"
                  disabled={!ticketLink.trim() || syncing}
                  onClick={syncFromJira}
                  className="flex-shrink-0 whitespace-nowrap rounded-[7px] border border-border bg-surface px-2.5 py-2 text-[11.5px] font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {syncing ? (
                    <i className="ti ti-loader-2 animate-spin text-[12px]" />
                  ) : (
                    'Sync from Jira'
                  )}
                </button>
              )}
            </div>
            {ticketLink.trim() && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-3">
                <i className="ti ti-brand-jira flex-shrink-0 text-[13px]" />
                <JiraTicketLink
                  ticketLink={ticketLink.trim()}
                  siteUrl={jiraSiteUrl || siteUrl}
                  className="truncate font-mono"
                />
              </p>
            )}
            {syncError && <p className="mt-1.5 text-[11px] font-medium text-danger">{syncError}</p>}
            {jiraStatus && (
              <p className="mt-1.5 text-[11px] text-text-3">
                Jira status: <span className="font-medium text-text-2">{jiraStatus}</span>
                {jiraSyncedAt && ` · synced ${new Date(jiraSyncedAt).toLocaleString()}`}
              </p>
            )}
          </Field>

          <p className="text-[12px] text-text-3">
            Editing this is the retest — nothing new gets created, Done/Remaining just move.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Done">
              <input
                type="number"
                min={0}
                max={issueCount}
                value={done}
                onFocus={e => e.currentTarget.select()}
                onChange={e => {
                  const n = parseInt(e.target.value, 10);
                  setDone(Number.isFinite(n) ? Math.min(Math.max(n, 0), issueCount) : 0);
                }}
                className={inputCls}
              />
            </Field>
            <Field label="Remaining">
              <input
                type="number"
                min={0}
                max={issueCount}
                value={remaining}
                onFocus={e => e.currentTarget.select()}
                onChange={e => {
                  const n = parseInt(e.target.value, 10);
                  const clamped = Number.isFinite(n)
                    ? Math.min(Math.max(n, 0), issueCount)
                    : issueCount;
                  setDone(issueCount - clamped);
                }}
                className={inputCls}
              />
            </Field>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-[12px] text-text-3">
              <span>
                {done} / {issueCount} resolved
              </span>
              <span className="font-semibold text-text">{percent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className={cn('h-full rounded-full', percent === 100 ? 'bg-success' : 'bg-primary')}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDone(issueCount)}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-2"
            >
              <i className="ti ti-circle-check text-[14px] text-success" />
              Mark Fully Resolved
            </button>
            <button
              type="button"
              onClick={() => setDone(0)}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-2"
            >
              <i className="ti ti-refresh text-[14px]" />
              Reset Progress
            </button>
          </div>

          {error && <p className="text-[12px] text-danger">{error}</p>}
        </div>

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
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
            <i className="ti ti-check text-[14px]" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared bits ────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[12px] font-medium text-text-2">{label}</p>
      {children}
    </div>
  );
}

function SuiteInput({
  value,
  onChange,
  suites,
}: {
  value: string;
  onChange: (v: string) => void;
  suites: { id: string; name: string }[];
}) {
  return (
    <>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Suite name…"
        list="quicklog-suite-options"
        className={inputCls}
      />
      <datalist id="quicklog-suite-options">
        {suites.map(s => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
    </>
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
  const id = `dl-${placeholder?.replace(/\W+/g, '') ?? 'opt'}`;
  return (
    <>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        list={id}
        className={inputCls}
      />
      <datalist id={id}>
        {options.map(o => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

function Counter({
  label,
  tone,
  value,
  onChange,
}: {
  label: string;
  tone: 'danger' | 'warning' | 'muted';
  value: number;
  onChange: (n: number) => void;
}) {
  const toneText =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-text-3';
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 text-center">
      <p className={cn('mb-1.5 text-[10px] font-semibold uppercase tracking-wider', toneText)}>
        {label}
      </p>
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border border-border text-text-2 transition-colors hover:bg-surface-2"
        >
          <i className="ti ti-minus text-[12px]" />
        </button>
        <span className="w-6 text-center text-[15px] font-bold text-text">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border border-border text-text-2 transition-colors hover:bg-surface-2"
        >
          <i className="ti ti-plus text-[12px]" />
        </button>
      </div>
    </div>
  );
}
