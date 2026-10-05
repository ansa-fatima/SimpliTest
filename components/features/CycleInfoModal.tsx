'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { cn, localDateStr, severityBadge } from '@/lib/utils';
import { JiraTicketLink, useJiraSiteUrl } from '@/lib/jiraLink';
import type { JiraSubIssueInfo } from '@/lib/jira';

interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  notRun: number;
  tester: string | null;
}
interface RecurringCase {
  id: string;
  caseNum: number;
  title: string;
  severity: string;
  cycleCount: number;
}
interface CycleJiraSubIssue {
  issueKey: string;
  title: string | null;
  severity: string;
  status: string;
  isReopened: boolean;
  timesReopened: number;
}
interface CycleHistoryInfo {
  id: string;
  name: string;
  description: string;
  mode: 'CaseBased' | 'Manual';
  status: string;
  portalName: string | null;
  moduleName: string | null;
  featureName: string | null;
  scopeName: string | null;
  version: string | null;
  environment: string | null;
  platform: string | null;
  cycleCategory: string | null;
  loggedBy: string;
  createdAt: string;
  completedAt: string | null;
  ticketLink: string | null;
  jiraStatus: string | null;
  jiraSyncedAt: string | null;
  jiraSiteUrl: string | null;
  issueCount: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  doneCount: number;
  remainingCount: number;
  reopenedCount: number;
  runSummary: RunSummary | null;
  recurringCases: RecurringCase[];
  jiraSubIssues: CycleJiraSubIssue[];
}

interface CycleInfoModalProps {
  cycleId: string;
  projectId: string | null;
  onClose: () => void;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wide text-text-3">{label}</p>
      <p className="text-[13px] text-text">{value}</p>
    </div>
  );
}

function RunStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-2.5 py-2 text-center">
      <p className={cn('text-[16px] font-semibold', tone)}>{value}</p>
      <p className="text-[10.5px] uppercase tracking-wide text-text-3">{label}</p>
    </div>
  );
}

// Read-only view of a cycle (quick log or test run) -- reached from Cycle
// History without ever navigating to a separate screen: the report already
// has everything at a glance, this modal just fills in the rest (run
// breakdown, recurring test cases, Jira sync) for whichever row was
// clicked. Backed by its own /history-info endpoint, not the general
// GET /api/cycles/:id every other screen uses.
export function CycleInfoModal({ cycleId, projectId, onClose }: CycleInfoModalProps) {
  const [cycle, setCycle] = useState<CycleHistoryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const siteUrl = useJiraSiteUrl(projectId);
  const jiraConnected = siteUrl !== null;

  const fetchInfo = useCallback(
    () => api.get<CycleHistoryInfo>(`/api/cycles/${cycleId}/history-info`),
    [cycleId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchInfo()
      .then(c => !cancelled && setCycle(c))
      .catch(e => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fetchInfo]);

  // Pulls fresh counts/status straight from the linked ticket, same
  // "Sync from Jira" the create/edit forms already offer -- this view
  // shouldn't be the one place you can't refresh a stale sync from.
  const resync = async () => {
    if (!projectId || !cycle?.ticketLink) return;
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
      }>(`/api/projects/${projectId}/integrations/jira/fetch`, { ticketLink: cycle.ticketLink });
      await api.patch(`/api/cycles/${cycleId}`, {
        // Auto-fills the cycle's own name from the parent ticket's title --
        // this view shows the name it patches, so a resync updates both.
        ...(result.title ? { name: result.title } : {}),
        jiraStatus: result.status,
        jiraSyncedAt: new Date().toISOString(),
        jiraSiteUrl: result.siteUrl,
        issueCount: result.issueCount,
        criticalCount: result.criticalCount,
        majorCount: result.majorCount,
        minorCount: result.minorCount,
        doneCount: result.doneCount,
        remainingCount: result.remainingCount,
        reopenedCount: result.reopenedCount,
        jiraSubIssues: result.subIssues,
      });
      setCycle(await fetchInfo());
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const isManual = (cycle?.mode ?? 'CaseBased') === 'Manual';
  const code = cycle ? `${isManual ? 'QL' : 'C'}-${cycle.id.slice(-4).toUpperCase()}` : '';
  const scopePath = cycle
    ? [cycle.portalName, cycle.moduleName, cycle.featureName ?? cycle.scopeName]
        .filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i)
        .join(' › ') || 'Unscoped'
    : '';

  const issueCount = cycle?.issueCount ?? 0;
  const done = cycle?.doneCount ?? 0;
  const percent = issueCount === 0 ? 0 : Math.round((done / issueCount) * 100);
  const severities: { label: string; value: number; dot: string; text: string }[] = cycle
    ? [
        {
          label: 'Critical',
          value: cycle.criticalCount ?? 0,
          dot: 'bg-danger',
          text: 'text-danger',
        },
        { label: 'Major', value: cycle.majorCount ?? 0, dot: 'bg-warning', text: 'text-warning' },
        { label: 'Minor', value: cycle.minorCount ?? 0, dot: 'bg-text-3', text: 'text-text-2' },
      ].filter(s => s.value > 0)
    : [];

  // Status rollup, derived once so the chip row above and the per-row left
  // border below never disagree.
  const statusOf = (s: CycleJiraSubIssue): 'Verified' | 'Done' | 'Open-to-do' | 'Reopened' =>
    s.isReopened || s.timesReopened > 0
      ? 'Reopened'
      : s.status === 'Done'
        ? 'Done'
        : s.status === 'Verified'
          ? 'Verified'
          : 'Open-to-do';
  const subRollup = { Verified: 0, Done: 0, 'Open-to-do': 0, Reopened: 0 };
  let stillOpen = 0;
  for (const s of cycle?.jiraSubIssues ?? []) {
    const st = statusOf(s);
    subRollup[st]++;
    if (st !== 'Done' && st !== 'Verified') stillOpen++;
  }
  const outcomeTone =
    cycle?.status === 'Completed' && cycle?.remainingCount === 0
      ? { label: 'Pass', bg: 'bg-success/15 text-success' }
      : cycle?.remainingCount && cycle.remainingCount > 0
        ? { label: 'Open', bg: 'bg-warning/15 text-warning' }
        : { label: cycle?.status ?? '—', bg: 'bg-surface-3 text-text-2' };

  const headerChips: { k: string; cls: string }[] = cycle
    ? [
        {
          k: outcomeTone.label,
          cls: `rounded-full px-2.5 py-1 text-[11px] font-semibold ${outcomeTone.bg}`,
        },
        ...(cycle.cycleCategory
          ? [
              {
                k: cycle.cycleCategory,
                cls: 'rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary',
              },
            ]
          : []),
        ...(cycle.environment
          ? [
              {
                k: cycle.environment,
                cls: 'rounded-full bg-surface-3 px-2.5 py-1 text-[11px] font-medium text-text-2',
              },
            ]
          : []),
      ]
    : [];

  const breadcrumb = cycle ? [cycle.moduleName, cycle.featureName].filter(Boolean).join(' · ') : '';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-full w-full max-w-[560px] flex-col overflow-hidden border-l border-border bg-surface shadow-2xl">
        {/* Header: chips row + close */}
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {headerChips.map(c => (
              <span key={c.k} className={c.cls}>
                {c.k}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded-md border border-border p-1.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <i className="ti ti-x text-[14px]" />
          </button>
        </div>

        {/* Title + breadcrumb + date/ticket pills */}
        {cycle && (
          <div className="border-b border-border px-5 pb-4">
            <h2 className="text-[15px] font-semibold leading-snug text-text">{cycle.name}</h2>
            {breadcrumb && <p className="mt-1 text-[12px] text-text-3">{breadcrumb}</p>}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-text-2">
                <i className="ti ti-calendar text-[11px] text-text-3" />
                {localDateStr(new Date(cycle.completedAt ?? cycle.createdAt))}
              </span>
              {cycle.ticketLink && (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-[11px]">
                  <JiraTicketLink
                    ticketLink={cycle.ticketLink}
                    siteUrl={cycle.jiraSiteUrl ?? siteUrl}
                    className="font-mono font-medium text-primary"
                  />
                </span>
              )}
              <span className="font-mono text-[10px] text-text-3">{code}</span>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          {loading && <p className="py-8 text-center text-[12.5px] text-text-3">Loading…</p>}
          {error && <p className="text-[12px] text-danger">{error}</p>}

          {cycle && !loading && (
            <>
              {cycle.description && (
                <p className="text-[12.5px] text-text-2">{cycle.description}</p>
              )}

              {/* Total / Open tiles -- the two headline numbers from the mockup. */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-surface-2 px-4 py-3.5">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider text-text-3">
                    Total issues
                  </p>
                  <p className="mt-0.5 text-[26px] font-semibold leading-none text-text">
                    {issueCount}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-surface-2 px-4 py-3.5">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider text-text-3">
                    Open
                  </p>
                  <p
                    className={cn(
                      'mt-0.5 text-[26px] font-semibold leading-none',
                      cycle.remainingCount > 0 ? 'text-danger' : 'text-success',
                    )}
                  >
                    {cycle.remainingCount}
                  </p>
                </div>
              </div>

              {/* Severity breakdown -- three tiles with colored left borders. */}
              {cycle.criticalCount + cycle.majorCount + cycle.minorCount > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-2">
                    Severity breakdown
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        k: 'Critical',
                        v: cycle.criticalCount,
                        border: 'border-l-danger',
                        color: 'text-danger',
                      },
                      {
                        k: 'Major',
                        v: cycle.majorCount,
                        border: 'border-l-warning',
                        color: 'text-warning',
                      },
                      {
                        k: 'Minor',
                        v: cycle.minorCount,
                        border: 'border-l-yellow-400',
                        color: 'text-yellow-500',
                      },
                    ].map(s => (
                      <div
                        key={s.k}
                        className={cn(
                          'rounded-lg border border-l-[3px] border-border bg-surface-2 px-3 py-2.5',
                          s.border,
                        )}
                      >
                        <p
                          className={cn(
                            'text-[10px] font-semibold uppercase tracking-wider',
                            s.color,
                          )}
                        >
                          {s.k}
                        </p>
                        <p className="mt-0.5 text-[20px] font-semibold leading-none text-text">
                          {s.v}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cycle meta -- kept for the fields the mockup doesn't surface at the top. */}
              <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-3">
                <div className="grid grid-cols-2 gap-3">
                  <InfoRow label="Location" value={scopePath} />
                  <InfoRow
                    label={isManual ? 'Logged by' : 'Tester'}
                    value={(isManual ? cycle.loggedBy : cycle.runSummary?.tester) || 'Unattributed'}
                  />
                  <InfoRow
                    label="Version"
                    value={cycle.version ? `v${cycle.version.replace(/^v\s*/i, '')}` : null}
                  />
                  <InfoRow label="Platform" value={cycle.platform} />
                  <InfoRow label="Status" value={cycle.status} />
                </div>
              </div>

              {/* Run breakdown -- CaseBased only, real per-case pass/fail/blocked
                  counts from this run's own TestRun rows. */}
              {cycle.runSummary && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-2">
                    Run results
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    <RunStat label="Passed" value={cycle.runSummary.passed} tone="text-success" />
                    <RunStat label="Failed" value={cycle.runSummary.failed} tone="text-danger" />
                    <RunStat label="Blocked" value={cycle.runSummary.blocked} tone="text-warning" />
                    <RunStat label="Not Run" value={cycle.runSummary.notRun} tone="text-text-3" />
                  </div>
                </div>
              )}

              {/* Recurring test cases -- of THIS run's own Failed/Blocked cases,
                  which also failed/blocked in some other cycle. Test-case
                  recurring only; Jira issues don't get this treatment here. */}
              {cycle.recurringCases.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-2">
                    Recurring test cases
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {cycle.recurringCases.map(c => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10.5px] text-text-3">
                              TC-{String(c.caseNum).padStart(4, '0')}
                            </span>
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                                severityBadge(c.severity as 'Critical' | 'Major' | 'Minor'),
                              )}
                            >
                              {c.severity}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[12.5px] font-medium text-text">
                            {c.title}
                          </p>
                        </div>
                        <span className="flex-shrink-0 text-[11px] font-medium text-danger">
                          {c.cycleCount}× cycles
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {issueCount > 0 && (
                <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-2.5">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-text-3">
                    <span>
                      {done} / {issueCount} resolved
                    </span>
                    <span className="font-semibold text-text">{percent}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        percent === 100 ? 'bg-success' : 'bg-primary',
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              )}

              {cycle.ticketLink && (
                <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-text-2">
                      <i className="ti ti-brand-jira flex-shrink-0 text-[13px] text-text-3" />
                      <JiraTicketLink
                        ticketLink={cycle.ticketLink}
                        siteUrl={cycle.jiraSiteUrl ?? siteUrl}
                        className="truncate font-mono"
                      />
                    </span>
                    {jiraConnected && (
                      <button
                        type="button"
                        disabled={syncing}
                        onClick={resync}
                        className="flex-shrink-0 whitespace-nowrap rounded-[7px] border border-border bg-surface px-2.5 py-1 text-[11.5px] font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {syncing ? (
                          <i className="ti ti-loader-2 animate-spin text-[12px]" />
                        ) : (
                          'Resync'
                        )}
                      </button>
                    )}
                  </div>
                  {syncError && (
                    <p className="mt-1.5 text-[11px] font-medium text-danger">{syncError}</p>
                  )}
                  {cycle.jiraStatus && (
                    <p className="mt-1.5 text-[11px] text-text-3">
                      Jira status:{' '}
                      <span className="font-medium text-text-2">{cycle.jiraStatus}</span>
                      {cycle.jiraSyncedAt &&
                        ` · synced ${new Date(cycle.jiraSyncedAt).toLocaleString()}`}
                    </p>
                  )}
                </div>
              )}

              {/* Jira sub-issues -- key/title/severity/status for either
                  mode. The Reopened badge (with the cycle's aggregate
                  reopened count) sits on whichever ticket is actually
                  reopened, not as a section-wide chip. Deliberately no
                  Recurring badge here: that's a test-case concept (see the
                  Recurring Test Cases section above), not a Jira one. */}
              {cycle.jiraSubIssues.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-2">
                    <i className="ti ti-list-check text-[13px] text-text-3" />
                    Sub-tasks{cycle.ticketLink ? ' · pulled from ' : ''}
                    {cycle.ticketLink && (
                      <JiraTicketLink
                        ticketLink={cycle.ticketLink}
                        siteUrl={cycle.jiraSiteUrl ?? siteUrl}
                        className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] normal-case tracking-normal text-primary"
                      />
                    )}
                  </p>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-3">
                      {[
                        { k: 'Verified' as const, dot: 'bg-success' },
                        { k: 'Done' as const, dot: 'bg-primary' },
                        { k: 'Open-to-do' as const, dot: 'bg-warning' },
                        { k: 'Reopened' as const, dot: 'bg-danger' },
                      ].map(({ k, dot }) => (
                        <span key={k} className="inline-flex items-center gap-1">
                          <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
                          <span className="font-semibold text-text">{subRollup[k]}</span> {k}
                        </span>
                      ))}
                    </div>
                    <span className="font-medium text-text-2">{stillOpen} still open</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {cycle.jiraSubIssues.map(s => {
                      const st = statusOf(s);
                      const borderCls =
                        st === 'Reopened'
                          ? 'border-l-danger'
                          : st === 'Open-to-do'
                            ? 'border-l-warning'
                            : st === 'Done'
                              ? 'border-l-primary'
                              : 'border-l-success';
                      const badgeCls =
                        st === 'Reopened'
                          ? 'bg-danger/15 text-danger'
                          : st === 'Open-to-do'
                            ? 'bg-warning/15 text-warning'
                            : st === 'Done'
                              ? 'bg-primary/15 text-primary'
                              : 'bg-success/15 text-success';
                      return (
                        <div
                          key={s.issueKey}
                          className={cn(
                            'flex items-start gap-3 rounded-lg border border-l-[3px] border-border bg-surface-2 px-3 py-2',
                            borderCls,
                          )}
                        >
                          <JiraTicketLink
                            ticketLink={s.issueKey}
                            siteUrl={cycle.jiraSiteUrl ?? siteUrl}
                            className="flex-shrink-0 rounded-md bg-surface-3 px-2 py-0.5 font-mono text-[10.5px] font-medium text-text-2"
                          />
                          <p
                            className="line-clamp-2 min-w-0 flex-1 break-words text-[12.5px] leading-snug text-text"
                            title={s.title || s.issueKey}
                          >
                            {s.title || s.issueKey}
                          </p>
                          <span
                            className={cn(
                              'flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                              badgeCls,
                            )}
                          >
                            {st}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[7px] border border-border bg-surface px-3.5 py-1.5 text-[13px] text-text transition-colors hover:bg-surface-2"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
