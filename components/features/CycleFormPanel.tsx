'use client';

import { useEffect, useMemo, useState } from 'react';
import { CycleScopeType, TestCycle } from '@/types';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';
import { CycleFormPayload } from './NewCycleModal';
import { JiraTicketLink, useJiraSiteUrl } from '@/lib/jiraLink';
import type { JiraSubIssueInfo } from '@/lib/jira';
import { CYCLE_OUTCOMES, deriveOutcome } from '@/lib/cycleOutcome';

interface ApiModule {
  id: string;
  name: string;
  portalId: string;
  suites: { id: string; name: string }[];
}
// Settings > Test configuration > Modules & features taxonomy.
interface QaFeatureNode {
  id: string;
  name: string;
}
interface QaModuleNode {
  id: string;
  name: string;
  features: QaFeatureNode[];
}
interface QaPortalNode {
  id: string;
  name: string;
  modules: QaModuleNode[];
}
interface ApiUser {
  id: string;
  name: string | null;
  username: string;
  email: string;
}

const ENVIRONMENTS = ['Production', 'QA', 'Staging', 'Dev'];
const PLATFORMS = ['Android', 'iPhone', 'Web', 'All', 'Desktop'];
const CATEGORIES = ['Functional', 'Regression', 'Stability', 'UI', 'Performance', 'Smoke'];

const inputCls =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light';
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-2';

interface CycleFormPanelProps {
  projectId: string | null;
  knownVersions: string[];
  /** Distinct module/feature pairs seen on existing quick logs -- used as the
   *  suggestion source for the Module + Feature pickers when the workspace
   *  has no real Portal > Module > Suite tree yet. */
  knownQuickLogs?: { moduleName: string | null; featureName: string | null }[];
  /** Pre-filled when editing an existing Manual cycle; null/absent = create. */
  initial?: TestCycle | null;
  /** Defaults the QA Engineer field on a fresh cycle (the session user). */
  defaultEngineer?: string;
  onClose: () => void;
  onCreate: (input: CycleFormPayload) => Promise<void>;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
}

// The full "Log a test cycle" slide-over — one form for both creating and
// editing a Manual (quick-log / testing-cycle) entry, matching the Testing
// Cycles mockup. Module + Date are the only required fields; everything else
// is optional. "Sync from Jira" pulls the parent ticket's children straight
// into the severity + open counts (see lib/jira.ts syncFromJira). Portal is
// derived from the picked module rather than asked for separately.
export function CycleFormPanel({
  projectId,
  knownVersions,
  knownQuickLogs = [],
  initial,
  defaultEngineer,
  onClose,
  onCreate,
  onUpdate,
}: CycleFormPanelProps) {
  const isEdit = !!initial;

  const [modules, setModules] = useState<ApiModule[]>([]);
  const [qaPortals, setQaPortals] = useState<QaPortalNode[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);

  // ── Core picks ──────────────────────────────────────────────
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  };
  const initialDate = initial?.completedAt ?? initial?.createdAt;
  const [date, setDate] = useState(initialDate ? initialDate.slice(0, 10) : todayStr());
  // Portal / Module / Feature are picked from the workspace's configured
  // taxonomy and stored by name; all three are optional. A legacy cycle whose
  // names are no longer in the taxonomy still shows them (see withCurrent).
  const [moduleNameFree, setModuleNameFree] = useState(initial?.moduleName ?? '');
  const [featureNameFree, setFeatureNameFree] = useState(initial?.featureName ?? '');
  const [portalNameFree, setPortalNameFree] = useState(initial?.portalName ?? '');

  const [environment, setEnvironment] = useState(initial?.environment ?? '');
  const [cycleCategory, setCycleCategory] = useState(initial?.cycleCategory ?? '');
  const [platform, setPlatform] = useState(initial?.platform ?? '');
  const [version, setVersion] = useState(initial?.version ?? '');
  const [ticketLink, setTicketLink] = useState(initial?.ticketLink ?? '');
  const [testRunLink, setTestRunLink] = useState(initial?.testRunLink ?? '');
  const [outcome, setOutcome] = useState<string>(initial ? deriveOutcome(initial) : 'Open');
  const [engineer, setEngineer] = useState(initial?.loggedBy ?? defaultEngineer ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [notes, setNotes] = useState(initial?.description ?? '');

  // ── Counts ──────────────────────────────────────────────────
  const [critical, setCritical] = useState(initial?.criticalCount ?? 0);
  const [major, setMajor] = useState(initial?.majorCount ?? 0);
  const [minor, setMinor] = useState(initial?.minorCount ?? 0);
  const [openIssues, setOpenIssues] = useState(
    initial?.remainingCount ?? Math.max(0, (initial?.issueCount ?? 0) - (initial?.doneCount ?? 0)),
  );
  const total = critical + major + minor;

  // ── Jira sync state ─────────────────────────────────────────
  const siteUrl = useJiraSiteUrl(projectId);
  const jiraConnected = siteUrl !== null;
  const [jiraStatus, setJiraStatus] = useState(initial?.jiraStatus ?? '');
  const [jiraSyncedAt, setJiraSyncedAt] = useState<string | null>(initial?.jiraSyncedAt ?? null);
  const [jiraSiteUrl, setJiraSiteUrl] = useState(initial?.jiraSiteUrl ?? '');
  const [reopenedCount, setReopenedCount] = useState(initial?.reopenedCount ?? 0);
  const [jiraSubIssues, setJiraSubIssues] = useState<JiraSubIssueInfo[]>([]);
  const [synced, setSynced] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Close on Escape, like the other modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const modUrl = projectId ? `/api/modules?projectId=${projectId}` : '/api/modules';
    api
      .get<ApiModule[]>(modUrl)
      .then(setModules)
      .catch(() => {});
    if (projectId) {
      api
        .get<QaPortalNode[]>(`/api/qa-portals?projectId=${projectId}`)
        .then(setQaPortals)
        .catch(() => {});
    }
    // Users for the QA Engineer dropdown -- same source the Owner filter
    // and Members page use, so a new workspace user shows up here
    // immediately without the form having its own cache.
    api
      .get<ApiUser[]>('/api/users')
      .then(setUsers)
      .catch(() => {});
  }, [projectId]);

  const portalName = portalNameFree;
  const moduleName = moduleNameFree;
  const featureName = featureNameFree;

  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const currentPortal = qaPortals.find(p => sameName(p.name, portalName)) ?? null;
  // With no portal chosen, Module lists every configured module.
  const moduleChoices = (currentPortal ? [currentPortal] : qaPortals).flatMap(p =>
    p.modules.map(m => ({ ...m, portalName: p.name })),
  );
  const currentModule = moduleChoices.find(m => sameName(m.name, moduleName)) ?? null;
  const featureChoices = currentModule?.features ?? [];
  // Keep a saved name selectable even if it was since removed from setup.
  const withCurrent = (names: string[], current: string) =>
    current.trim() && !names.some(n => sameName(n, current)) ? [...names, current] : names;

  // Quick logs join the Stability report through a test-case-tree scope, so
  // when the picked module/feature exists there by name, keep that scope.
  const treeModule = moduleName.trim()
    ? (modules.find(m => sameName(m.name, moduleName)) ?? null)
    : null;
  const treeSuite = treeModule?.suites.find(s => sameName(s.name, featureName)) ?? null;
  const derivedScope: { scopeType: CycleScopeType; scopeId: string | null } = treeSuite
    ? { scopeType: 'Suite', scopeId: treeSuite.id }
    : treeModule
      ? { scopeType: 'Module', scopeId: treeModule.id }
      : { scopeType: 'All', scopeId: null };

  const autoFill = () => {
    const bits = [
      [portalName, moduleName].filter(Boolean).join('/'),
      featureName,
      cycleCategory ? `${cycleCategory} Testing` : null,
    ].filter(Boolean);
    setName(bits.join(' - '));
  };

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
      if (result.title && !name.trim()) setName(result.title);
      setJiraStatus(result.status);
      setJiraSyncedAt(new Date().toISOString());
      setJiraSiteUrl(result.siteUrl);
      setCritical(result.criticalCount);
      setMajor(result.majorCount);
      setMinor(result.minorCount);
      setOpenIssues(result.remainingCount);
      setReopenedCount(result.reopenedCount);
      setJiraSubIssues(result.subIssues);
      setSynced(true);
      // A ticket with open children is clearly still in progress; one fully
      // done reads as a pass. Only nudge the outcome when it's still the
      // default "Open" so an explicit choice is never overwritten.
      if (outcome === 'Open' && result.issueCount > 0) {
        setOutcome(result.remainingCount > 0 ? 'Open' : 'Pass');
      }
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const submit = async () => {
    setError('');
    if (!date) {
      setError('Date is required');
      return;
    }
    setSubmitting(true);
    const issueCount = total;
    const remaining = Math.min(openIssues, issueCount);
    const done = Math.max(0, issueCount - remaining);
    const completedAt = new Date(`${date}T00:00:00`).toISOString();
    const finalName =
      name.trim() ||
      [moduleName, featureName].filter(Boolean).join(' → ') ||
      `Testing cycle — ${date}`;

    try {
      if (isEdit && initial) {
        const patch: Record<string, unknown> = {
          name: finalName,
          description: notes,
          completedAt,
          scopeType: derivedScope.scopeType,
          scopeId: derivedScope.scopeId,
          portalName: portalName || null,
          moduleName: moduleName || null,
          featureName: featureName || null,
          environment: environment || null,
          platform: platform || null,
          version: version.trim() || null,
          cycleCategory: cycleCategory || null,
          ticketLink: ticketLink.trim() || null,
          testRunLink: testRunLink.trim() || null,
          outcome: outcome || null,
          loggedBy: engineer.trim(),
          issueCount,
          criticalCount: critical,
          majorCount: major,
          minorCount: minor,
          doneCount: done,
          remainingCount: remaining,
        };
        if (synced) {
          patch.jiraStatus = jiraStatus;
          patch.jiraSyncedAt = jiraSyncedAt;
          patch.jiraSiteUrl = jiraSiteUrl;
          patch.reopenedCount = reopenedCount;
          patch.jiraSubIssues = jiraSubIssues;
        }
        await onUpdate(initial.id, patch);
      } else {
        await onCreate({
          name: finalName,
          description: notes,
          mode: 'Manual',
          completedAt,
          scopeType: derivedScope.scopeType,
          scopeId: derivedScope.scopeId,
          portalName: portalName || undefined,
          moduleName: moduleName || undefined,
          featureName: featureName || undefined,
          environment: environment || undefined,
          platform: platform || undefined,
          version: version.trim() || undefined,
          cycleCategory: cycleCategory || undefined,
          ticketLink: ticketLink.trim() || undefined,
          testRunLink: testRunLink.trim() || undefined,
          outcome: outcome || undefined,
          loggedBy: engineer.trim() || undefined,
          jiraStatus: synced ? jiraStatus : undefined,
          jiraSyncedAt: synced ? jiraSyncedAt : undefined,
          jiraSiteUrl: synced ? jiraSiteUrl : undefined,
          jiraSubIssues: synced && jiraSubIssues.length > 0 ? jiraSubIssues : undefined,
          issueCount,
          criticalCount: critical,
          majorCount: major,
          minorCount: minor,
          doneCount: done,
          remainingCount: remaining,
          reopenedCount: synced ? reopenedCount : undefined,
        });
      }
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={onClose}>
      <div
        className="flex h-full w-full max-w-[640px] flex-col overflow-hidden border-l border-border bg-bg shadow-2xl"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-2.5 py-1 text-[11px] font-semibold text-primary-text">
              <i className="ti ti-plus text-[13px]" />
              {isEdit ? 'Edit cycle' : 'New cycle'}
            </span>
            <h2 className="mt-2 text-[17px] font-semibold text-text">Log a test cycle</h2>
            <p className="text-[12.5px] text-text-2">
              Every field except Date is optional. Stability updates the moment you save.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded-md p-1.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <i className="ti ti-x text-[16px]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>
                Date <span className="text-danger">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Portal</label>
              <select
                value={portalName}
                onChange={e => {
                  setPortalNameFree(e.target.value);
                  // A module from another portal no longer applies.
                  const p = qaPortals.find(pp => sameName(pp.name, e.target.value));
                  if (p && !p.modules.some(m => sameName(m.name, moduleName))) {
                    setModuleNameFree('');
                    setFeatureNameFree('');
                  }
                }}
                className={inputCls}
              >
                <option value="">—</option>
                {withCurrent(
                  qaPortals.map(p => p.name),
                  portalName,
                ).map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Module</label>
              <select
                value={moduleName}
                onChange={e => {
                  const m = moduleChoices.find(mm => sameName(mm.name, e.target.value));
                  setModuleNameFree(e.target.value);
                  setFeatureNameFree('');
                  if (m && !portalName) setPortalNameFree(m.portalName);
                }}
                className={inputCls}
              >
                <option value="">—</option>
                {withCurrent(
                  moduleChoices.map(m => m.name),
                  moduleName,
                ).map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Feature</label>
              <select
                value={featureName}
                onChange={e => setFeatureNameFree(e.target.value)}
                disabled={!moduleName && !featureName}
                className={cn(inputCls, !moduleName && !featureName && 'opacity-60')}
              >
                <option value="">{moduleName ? '—' : 'Pick a module first'}</option>
                {withCurrent(
                  featureChoices.map(ft => ft.name),
                  featureName,
                ).map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-text-3">
            {qaPortals.length === 0
              ? 'No portals set up yet — add them under Settings → Test configuration.'
              : 'Portals, modules and features come from Settings → Test configuration.'}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Environment</label>
              <SelectWithCustom
                value={environment}
                onChange={setEnvironment}
                options={ENVIRONMENTS}
                placeholder="Production / QA / …"
              />
            </div>
            <div>
              <label className={labelCls}>Cycle Type</label>
              <SelectWithCustom
                value={cycleCategory}
                onChange={setCycleCategory}
                options={CATEGORIES}
                placeholder="Functional / Regression / …"
              />
            </div>
            <div>
              <label className={labelCls}>Platform</label>
              <SelectWithCustom
                value={platform}
                onChange={setPlatform}
                options={PLATFORMS}
                placeholder="Android / iPhone / Web"
              />
            </div>
            <div>
              <label className={labelCls}>Version</label>
              <SelectWithCustom
                value={version}
                onChange={setVersion}
                options={knownVersions}
                placeholder="v3.0.140"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Parent Ticket</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={ticketLink}
                  onChange={e => {
                    setTicketLink(e.target.value);
                    setSynced(false);
                  }}
                  placeholder="NPD-11800"
                  className={cn(inputCls, 'flex-1')}
                />
                {jiraConnected && (
                  <button
                    type="button"
                    disabled={!ticketLink.trim() || syncing}
                    onClick={syncFromJira}
                    title="Fetch the ticket's child issues from Jira"
                    className="flex-shrink-0 whitespace-nowrap rounded-[7px] border border-border bg-surface px-2.5 py-2 text-[11.5px] font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {syncing ? <i className="ti ti-loader-2 animate-spin text-[12px]" /> : 'Sync'}
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-text-3">
                Jira ticket key. Sub-tasks pulled in on sync.
              </p>
              {ticketLink.trim() && (
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-text-3">
                  <i className="ti ti-brand-jira flex-shrink-0 text-[12px]" />
                  <JiraTicketLink
                    ticketLink={ticketLink.trim()}
                    siteUrl={jiraSiteUrl || siteUrl}
                    className="truncate font-mono"
                  />
                </p>
              )}
              {syncError && <p className="mt-1 text-[11px] font-medium text-danger">{syncError}</p>}
              {jiraStatus && (
                <p className="mt-1 text-[11px] text-text-3">
                  Jira status: <span className="font-medium text-text-2">{jiraStatus}</span>
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>Outcome</label>
              <select
                value={outcome}
                onChange={e => setOutcome(e.target.value)}
                className={inputCls}
              >
                {CYCLE_OUTCOMES.map(o => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label className={labelCls}>QA Engineer</label>
            {users.length > 0 ? (
              <>
                <select
                  value={
                    users.some(u => (u.name || u.username) === engineer) || engineer === ''
                      ? engineer
                      : '__custom__'
                  }
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '__custom__') return; // keep whatever free-text is in `engineer`
                    setEngineer(v);
                  }}
                  className={inputCls}
                >
                  <option value="">Unattributed</option>
                  {users.map(u => (
                    <option key={u.id} value={u.name || u.username}>
                      {u.name || u.username}
                    </option>
                  ))}
                  {engineer && !users.some(u => (u.name || u.username) === engineer) && (
                    <option value="__custom__">{engineer} (not a workspace user)</option>
                  )}
                </select>
                {engineer && !users.some(u => (u.name || u.username) === engineer) && (
                  <p className="mt-1 text-[11px] text-text-3">
                    This cycle has a name that isn&apos;t in the workspace; pick someone to replace
                    it.
                  </p>
                )}
              </>
            ) : (
              <input
                type="text"
                value={engineer}
                onChange={e => setEngineer(e.target.value)}
                placeholder="Person who ran this cycle"
                className={inputCls}
              />
            )}
          </div>

          {/* Severity breakdown */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-text-2">
                Severity Breakdown
              </label>
              <span className="text-[12px] text-text-2">
                Total: <span className="font-semibold text-text">{total}</span> issues
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <SeverityInput
                label="Critical"
                dot="bg-danger"
                value={critical}
                onChange={setCritical}
              />
              <SeverityInput label="Major" dot="bg-warning" value={major} onChange={setMajor} />
              <SeverityInput label="Minor" dot="bg-text-3" value={minor} onChange={setMinor} />
            </div>
            <p className="mt-1.5 text-[11px] text-text-3">
              Count of issues per severity found in this cycle.
            </p>
          </div>

          <div className="mt-4">
            <label className={labelCls}>Open Issues</label>
            <input
              type="number"
              min={0}
              value={openIssues}
              onFocus={e => e.currentTarget.select()}
              onChange={e => {
                const n = parseInt(e.target.value, 10);
                setOpenIssues(Number.isFinite(n) && n >= 0 ? n : 0);
              }}
              className={cn(inputCls, 'max-w-[140px]')}
            />
            <p className="mt-1 text-[11px] text-text-3">Still unresolved at cycle end.</p>
          </div>

          <div className="mt-5">
            <label className={labelCls}>Ticket Description</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Role · module · feature · cycle-type summary"
                className={cn(inputCls, 'flex-1')}
              />
              <button
                type="button"
                onClick={autoFill}
                className="flex-shrink-0 whitespace-nowrap rounded-[7px] bg-primary-light px-3 py-2 text-[12px] font-semibold text-primary-text transition-colors hover:bg-primary-light/70"
              >
                <i className="ti ti-sparkles mr-1 text-[13px]" />
                Auto-fill
              </button>
            </div>
            <p className="mt-1 text-[11px] text-text-3">Auto-fill composes it from your picks.</p>
          </div>

          <div className="mt-4">
            <label className={labelCls}>Test-Run Link</label>
            <input
              type="text"
              value={testRunLink}
              onChange={e => setTestRunLink(e.target.value)}
              placeholder="https://…"
              className={inputCls}
            />
          </div>

          <div className="mt-4">
            <label className={labelCls}>Notes / Feedback</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything the team should know — remaining scenarios, blockers, retest scope…"
              className={cn(inputCls, 'resize-none')}
            />
          </div>

          {error && <p className="mt-4 text-[12px] font-medium text-danger">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-[7px] border border-border bg-surface px-4 py-2 text-[13px] text-text transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <i className="ti ti-loader-2 animate-spin text-[14px]" />
            ) : (
              <i className="ti ti-check text-[14px]" />
            )}
            {isEdit ? 'Save changes' : 'Save cycle'}
          </button>
        </div>
      </div>
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
  const id = useMemo(() => `dl-${Math.random().toString(36).slice(2, 8)}`, []);
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

function SeverityInput({
  label,
  dot,
  value,
  onChange,
}: {
  label: string;
  dot: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className={cn('h-2.5 w-2.5 rounded-sm', dot)} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-2">
          {label}
        </span>
      </div>
      <input
        type="number"
        min={0}
        value={value}
        onFocus={e => e.currentTarget.select()}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className={inputCls}
      />
    </div>
  );
}
