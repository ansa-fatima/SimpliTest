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
type SubStatus = 'Verified' | 'Done' | 'In QA' | 'In progress' | 'Open-to-do' | 'Reopened';

interface CycleJiraSubIssue {
  issueKey: string;
  title: string | null;
  severity: string;
  status: string;
  /** Jira statusCategory = done (Closed, Resolved, Verified, ...). */
  isDone?: boolean;
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
  // Each linked parent ticket with its current Jira status (ticketLink can hold several).
  const [parents, setParents] = useState<
    { key: string; title: string | null; status: string | null; category: string | null }[]
  >([]);

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

  useEffect(() => {
    if (!cycle?.ticketLink) {
      setParents([]);
      return;
    }
    let cancelled = false;
    api
      .get<{ items: typeof parents }>(`/api/cycles/${cycleId}/parent-tickets`)
      .then(r => !cancelled && setParents(r.items))
      .catch(() => !cancelled && setParents([]));
    return () => {
      cancelled = true;
    };
  }, [cycleId, cycle?.ticketLink, cycle?.jiraSyncedAt]);

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
  // A ticket that is still open keeps Jira's own words: sitting in "In QA"
  // is not the same as "Open-to-do", so QA and in-flight statuses get their
  // own buckets and the row badge shows the real Jira status name.
  const statusOf = (s: CycleJiraSubIssue): SubStatus => {
    // `isReopened` reflects the ticket's CURRENT status (name contains
    // "Reopened"). `timesReopened` is a lifetime counter -- it never
    // decreases, so a ticket moved from Reopened to In QA / In progress
    // / Done must not keep reading as "Reopened" just because it has
    // been reopened before. The lifetime count is still available for a
    // side badge where it is useful.
    if (s.isReopened) return 'Reopened';
    if (/^verified$/i.test(s.status)) return 'Verified';
    if (s.isDone || /^(done|closed|resolved)$/i.test(s.status)) return 'Done';
    if (/\bqa\b|\btest|review|verif|\buat\b/i.test(s.status)) return 'In QA';
    if (/progress|develop|doing|implement|coding/i.test(s.status)) return 'In progress';
    return 'Open-to-do';
  };
  const subRollup: Record<SubStatus, number> = {
    Verified: 0,
    Done: 0,
    'In QA': 0,
    'In progress': 0,
    'Open-to-do': 0,
    Reopened: 0,
  };
  let stillOpen = 0;
  for (const s of cycle?.jiraSubIssues ?? []) {
    const st = statusOf(s);
    subRollup[st]++;
    if (st !== 'Done' && st !== 'Verified') stillOpen++;
  }
  // Jira-palette status styles -- same tokens for the per-row badge, the
  // left border, and the dots in the rollup summary, so a quick scan reads
  // the colour the same way everywhere. Chosen to match Atlassian's
  // Lozenge semantics: Done + Verified green (success), To-Do grey
  // (default), Reopened orange (moved/attention), with the Reopened case
  // deliberately NOT red so a healthy row full of Reopens doesn't scream
  // "failed".
  const JIRA_STATUS: Record<SubStatus, { badge: string; border: string; dot: string }> = {
    'Open-to-do': {
      badge: 'bg-[#DFE1E6] text-[#42526E]',
      border: 'border-l-[#97A0AF]',
      dot: 'bg-[#97A0AF]',
    },
    'In progress': {
      badge: 'bg-[#DEEBFF] text-[#0747A6]',
      border: 'border-l-[#4C9AFF]',
      dot: 'bg-[#4C9AFF]',
    },
    'In QA': {
      badge: 'bg-[#DEEBFF] text-[#0747A6]',
      border: 'border-l-[#2684FF]',
      dot: 'bg-[#2684FF]',
    },
    Reopened: {
      badge: 'bg-[#DFE1E6] text-[#42526E]',
      border: 'border-l-[#97A0AF]',
      dot: 'bg-[#97A0AF]',
    },
    Done: {
      badge: 'bg-[#E3FCEF] text-[#006644]',
      border: 'border-l-[#36B37E]',
      dot: 'bg-[#36B37E]',
    },
    Verified: {
      badge: 'bg-[#ABF5D1] text-[#006644]',
      border: 'border-l-[#00875A]',
      dot: 'bg-[#00875A]',
    },
  };

  // Derived "QA Status" -- the single word that answers "is this cycle
  // closed?" without the reader having to count sub-tasks. Rules kept
  // simple so the chip is explainable in one line:
  //   any Reopened -> Reopened (requires a retest)
  //   any Open-to-do -> QA In Progress
  //   all Done + at least one Verified -> QA Approved
  //   all Done, nothing Verified -> QA Passed
  //   no sub-tasks -> fall back to the cycle.status (New / Active / Completed)
  const subTotal = cycle?.jiraSubIssues.length ?? 0;
  const qaStatus: { label: string; cls: string } = (() => {
    // Jira-palette lozenges: Done + Verified green (Jira "success"),
    // In-progress / QA light blue (Jira "inprogress"), Reopened orange
    // (Jira "moved"). Matches the Status column of a real Jira sub-task
    // list, so a reader coming from Jira doesn't have to re-learn colours.
    if (!cycle) return { label: '—', cls: 'bg-surface-3 text-text-2' };
    if (subTotal === 0) return { label: cycle.status, cls: 'bg-surface-3 text-text-2' };
    if (subRollup.Reopened > 0) return { label: 'Reopened', cls: JIRA_STATUS.Reopened.badge };
    if (subRollup['Open-to-do'] + subRollup['In progress'] + subRollup['In QA'] > 0)
      return { label: 'QA In Progress', cls: JIRA_STATUS['In progress'].badge };
    if (subRollup.Verified > 0) return { label: 'QA Approved', cls: JIRA_STATUS.Verified.badge };
    return { label: 'QA Passed', cls: JIRA_STATUS.Done.badge };
  })();
  const outcomeTone =
    cycle?.status === 'Completed' && cycle?.remainingCount === 0
      ? { label: 'Pass', bg: 'border border-[#86efac] bg-[#dcfce7] text-[#16a34a]' }
      : cycle?.remainingCount && cycle.remainingCount > 0
        ? { label: 'Open', bg: 'border border-[#fcd34d] bg-[#fef3c7] text-[#d97706]' }
        : { label: cycle?.status ?? '—', bg: 'bg-surface-3 text-text-2' };

  const headerChips: { k: string; cls: string }[] = cycle
    ? [
        {
          k: outcomeTone.label,
          cls: `rounded-full px-2.5 py-1 text-[11px] font-semibold ${outcomeTone.bg}`,
        },
        {
          k: qaStatus.label,
          cls: `rounded-full px-2.5 py-1 text-[11px] font-semibold ${qaStatus.cls}`,
        },
        ...(cycle.cycleCategory
          ? [
              {
                k: cycle.cycleCategory,
                cls: 'rounded-full bg-[#eeeafb] px-2.5 py-1 text-[11px] font-medium text-[#3f2daa]',
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
        ...(cycle.version
          ? [
              {
                k: `v${cycle.version.replace(/^v\s*/i, '')}`,
                cls: 'rounded-full bg-[#eeeafb] px-2.5 py-1 font-mono text-[11px] font-medium text-[#3f2daa]',
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
                <span className="inline-flex items-center rounded-full bg-[#eeeafb] px-2.5 py-1 text-[11px]">
                  <JiraTicketLink
                    ticketLink={cycle.ticketLink}
                    siteUrl={cycle.jiraSiteUrl ?? siteUrl}
                    className="font-mono font-medium text-[#3f2daa]"
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

              {/* Cycle meta block removed per design -- Location, Logged by,
                  Version, Platform, Status already surface on the row and
                  in the header chips above. */}

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
                        percent === 100 ? 'bg-success' : 'bg-[#3f2daa]',
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* The old parent-ticket card lived here; it duplicated the
                  header pill and the "pulled from" chip right below, so it
                  was removed. Resync + jiraStatus moved into the sub-tasks
                  header line (jiraConnected only). */}

              {/* Jira sub-issues -- key/title/severity/status for either
                  mode. The Reopened badge (with the cycle's aggregate
                  reopened count) sits on whichever ticket is actually
                  reopened, not as a section-wide chip. Deliberately no
                  Recurring badge here: that's a test-case concept (see the
                  Recurring Test Cases section above), not a Jira one. */}
              {cycle.jiraSubIssues.length > 0 && (
                <div>
                  <div className="mb-2 flex flex-col gap-1.5">
                    {(parents.length > 0
                      ? parents
                      : cycle.ticketLink
                        ? [
                            {
                              key: cycle.ticketLink,
                              title: null,
                              status: cycle.jiraStatus,
                              category: null,
                            },
                          ]
                        : [{ key: '', title: null, status: null, category: null }]
                    ).map((p, i) => (
                      <div key={p.key || i} className="flex items-center justify-between gap-2">
                        <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-2">
                          {i === 0 ? (
                            <>
                              <i className="ti ti-list-check text-[13px] text-text-3" />
                              <span className="flex-shrink-0">
                                Sub-tasks{cycle.ticketLink ? ' · pulled from ' : ''}
                              </span>
                            </>
                          ) : (
                            <span className="flex-shrink-0 pl-[19px] text-text-3">and</span>
                          )}
                          {p.key && (
                            <JiraTicketLink
                              ticketLink={p.key}
                              siteUrl={cycle.jiraSiteUrl ?? siteUrl}
                              className="rounded-md bg-[#eeeafb] px-1.5 py-0.5 font-mono text-[11px] normal-case tracking-normal text-[#3f2daa]"
                            />
                          )}
                        </p>
                        {p.status && (
                          <span
                            title={
                              p.title ? `${p.key}: ${p.title}` : 'Parent ticket status in Jira'
                            }
                            className={cn(
                              'flex-shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold',
                              p.category === 'done'
                                ? JIRA_STATUS.Done.badge
                                : p.category === 'indeterminate'
                                  ? JIRA_STATUS['In progress'].badge
                                  : JIRA_STATUS['Open-to-do'].badge,
                            )}
                          >
                            {p.status}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
                          qaStatus.cls,
                        )}
                      >
                        {qaStatus.label}
                      </span>
                      <span className="mx-1 h-3 w-px bg-border" />
                      {(
                        [
                          'Open-to-do',
                          'In progress',
                          'In QA',
                          'Reopened',
                          'Done',
                          'Verified',
                        ] as const
                      ).map(k => (
                        <span
                          key={k}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium',
                            JIRA_STATUS[k].badge,
                          )}
                        >
                          <span className="font-bold">{subRollup[k]}</span>
                          {k}
                        </span>
                      ))}
                    </div>
                    <span className="font-medium text-text-2">{stillOpen} still open</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {cycle.jiraSubIssues.map(s => {
                      const st = statusOf(s);
                      const borderCls = JIRA_STATUS[st].border;
                      const badgeCls = JIRA_STATUS[st].badge;
                      return (
                        <div
                          key={s.issueKey}
                          className={cn(
                            'flex items-start gap-3 rounded-lg border border-l-[3px] border-border bg-surface-2 px-3 py-2 transition-colors hover:bg-[#f6f4fe]',
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
                            {st === 'Reopened' ? st : s.status || st}
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
