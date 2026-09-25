// Jira Cloud REST API v3 client -- HTTP Basic auth (email + API token, see
// id.atlassian.com/manage-profile/security/api-tokens), not OAuth 3LO, since
// that requires registering and getting Atlassian's approval for a public
// OAuth app. See prisma/schema.prisma's JiraConnection model for the stored
// shape and app/api/projects/[id]/integrations/jira/route.ts for where
// credentials are validated and saved. Verified live against a real Jira
// Cloud site.

export interface JiraCreds {
  /** Jira Cloud site base URL, e.g. "https://your-team.atlassian.net" (no trailing slash). */
  siteUrl: string;
  email: string;
  apiToken: string;
}

export class JiraApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function authHeader(creds: JiraCreds): string {
  return 'Basic ' + Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64');
}

function siteBase(creds: JiraCreds): string {
  return creds.siteUrl.trim().replace(/\/+$/, '');
}

async function jiraFetch(
  creds: JiraCreds,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const url = `${siteBase(creds)}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: authHeader(creds),
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new JiraApiError('Could not reach the Jira site -- check the site URL');
  }
  if (res.status === 401) throw new JiraApiError('Invalid email or API token', 401);
  if (res.status === 403) throw new JiraApiError('This account cannot access that in Jira', 403);
  if (res.status === 404) throw new JiraApiError('Not found in Jira', 404);
  if (!res.ok) throw new JiraApiError(`Jira returned ${res.status}`, res.status);
  if (res.status === 204) return null;
  return res.json();
}

// Validates credentials by fetching the authenticated user -- the standard
// Jira Cloud "who am I" check, cheap and side-effect free.
export async function testConnection(creds: JiraCreds): Promise<{ displayName: string }> {
  const me = (await jiraFetch(creds, '/rest/api/3/myself')) as { displayName?: string };
  return { displayName: me.displayName || creds.email };
}

// Pulls a Jira issue key ("NPD-10656") out of either a bare key or a full
// Jira URL. TestCycle.ticketLink's placeholder already says "JIRA-1234 or a
// full URL" -- users already paste either form there, so Jira sync reads
// straight from that existing field instead of a redundant new one.
const ISSUE_KEY_RE = /([A-Z][A-Z0-9]+-\d+)/;
export function parseIssueKey(ticketLink: string | null | undefined): string | null {
  if (!ticketLink) return null;
  const m = ticketLink.toUpperCase().match(ISSUE_KEY_RE);
  return m ? m[1] : null;
}

// Derives a Jira site's origin from a full ticket URL someone pasted into
// ticketLink -- cached onto TestCycle.jiraSiteUrl (see the cycles POST/PATCH
// routes) so that if they later shorten the field down to just the bare key
// ("NPD-12167"), the link stays resolvable without ever needing an active
// JiraConnection or a "Sync from Jira" to have run.
export function deriveSiteUrlFromTicketLink(ticketLink: string): string | null {
  if (!/^https?:\/\//i.test(ticketLink)) return null;
  try {
    const u = new URL(ticketLink);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

interface JiraIssueFields {
  status?: { name?: string; statusCategory?: { key?: string } };
  priority?: { name?: string };
  summary?: string;
  subtasks?: { key: string }[];
  // Custom fields are keyed by id ("customfield_10119"), looked up
  // dynamically per site -- see findSeverityFieldId(). A select-list custom
  // field's chosen option carries its label as `value`, not `name`.
  [customFieldId: string]: unknown;
}
interface JiraIssueLike {
  key: string;
  fields: JiraIssueFields;
}

type Bucket = 'Critical' | 'Major' | 'Minor';

// Default Jira priority -> our Critical/Major/Minor bucket, covering Jira
// Cloud's standard 5-level scheme (Highest/High/Medium/Low/Lowest). Only
// used as a FALLBACK -- see findSeverityFieldId() below for why a
// dedicated "Severity" field, when the project has one, wins instead:
// confirmed live that a QA-style Jira project commonly tracks bug severity
// (Critical/Major/Minor) as its own custom field, completely independent of
// the built-in Priority field (an issue can be Priority=Medium and
// Severity=Critical at the same time).
const PRIORITY_BUCKET: Record<string, Bucket> = {
  highest: 'Critical',
  high: 'Critical',
  medium: 'Major',
  low: 'Minor',
  lowest: 'Minor',
};

// Matches a severity-field option's own label (whatever words the connected
// project's admin chose) to our bucket -- broader than PRIORITY_BUCKET's
// exact 5 names since a custom field's options are free-form.
function severityLabelBucket(label: string): Bucket | null {
  const key = label.toLowerCase();
  if (key.includes('critical') || key.includes('blocker')) return 'Critical';
  if (key.includes('major')) return 'Major';
  if (key.includes('minor') || key.includes('trivial')) return 'Minor';
  return null;
}

function bucketOf(fields: JiraIssueFields, severityFieldId: string | null): Bucket {
  if (severityFieldId) {
    const raw = fields[severityFieldId] as { value?: string } | null | undefined;
    const bucket = raw?.value ? severityLabelBucket(raw.value) : null;
    if (bucket) return bucket;
  }
  const priorityName = fields.priority?.name;
  if (!priorityName) return 'Minor';
  return PRIORITY_BUCKET[priorityName.toLowerCase()] ?? 'Minor';
}

interface JiraFieldDef {
  id: string;
  name: string;
  custom: boolean;
}

// Looks for a project-defined "Severity" custom field (any select-list
// field literally named that, case-insensitive) -- common on QA-oriented
// Jira projects that track bug severity separately from the built-in
// Priority field. Returns null when the connected site has no such field,
// so bucketOf() falls back to Priority-based classification.
async function findSeverityFieldId(creds: JiraCreds): Promise<string | null> {
  const fields = (await jiraFetch(creds, '/rest/api/3/field')) as JiraFieldDef[];
  const match = fields.find(f => f.custom && f.name?.toLowerCase() === 'severity');
  return match?.id ?? null;
}

// Jira's standardized statusCategory.key ('new' | 'indeterminate' | 'done')
// is stable across any custom workflow status names a workspace might use --
// only 'done' counts as resolved.
function isDone(statusCategoryKey: string | undefined): boolean {
  return statusCategoryKey === 'done';
}

// "Reopened" isn't a statusCategory Jira standardizes -- it's a workflow
// status name a team defines itself (distinct from "To Do"/"Open"). Matched
// by name rather than category since a reopened issue's category is still
// 'new' or 'indeterminate', same as any other not-done status.
function isReopened(statusName: string | undefined): boolean {
  return !!statusName && statusName.toLowerCase().includes('reopen');
}

// Status -> {status, isDone, isReopened}, factored out of tally()'s loop
// purely to keep that loop readable.
function classifyIssueStatus(fields: {
  status?: { name?: string; statusCategory?: { key?: string } };
}): { status: string; isDone: boolean; isReopened: boolean } {
  const status = fields.status?.name || 'Unknown';
  const done = isDone(fields.status?.statusCategory?.key);
  const reopened = !done && isReopened(status);
  return { status, isDone: done, isReopened: reopened };
}

// One synced sub-issue -- persisted verbatim into JiraSubIssue (see
// prisma/schema.prisma) so Recurring/Reopened detection can query across
// every cycle's last sync without re-hitting Jira. `key` is the CHILD's own
// issue key (e.g. "NPD-12168"), not the parent ticket's.
export interface JiraSubIssueInfo {
  key: string;
  title: string;
  severity: Bucket;
  status: string;
  isDone: boolean;
  isReopened: boolean;
}

export interface JiraSyncResult {
  issueKey: string;
  title: string;
  status: string;
  issueCount: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  doneCount: number;
  remainingCount: number;
  // Of remainingCount, how many are specifically back-open after being
  // marked Done (see isReopened) -- a subset of remainingCount, not
  // additional to it, so doneCount + remainingCount still equals issueCount.
  reopenedCount: number;
  subIssues: JiraSubIssueInfo[];
}

function tally(
  issueKey: string,
  title: string,
  status: string,
  children: JiraIssueLike[],
  severityFieldId: string | null,
): JiraSyncResult {
  let critical = 0;
  let major = 0;
  let minor = 0;
  let done = 0;
  let remaining = 0;
  let reopened = 0;
  const subIssues: JiraSubIssueInfo[] = [];
  for (const c of children) {
    const bucket = bucketOf(c.fields, severityFieldId);
    if (bucket === 'Critical') critical++;
    else if (bucket === 'Major') major++;
    else minor++;
    const {
      status: childStatus,
      isDone: childIsDone,
      isReopened: childIsReopened,
    } = classifyIssueStatus(c.fields);
    if (childIsDone) done++;
    else {
      remaining++;
      if (childIsReopened) reopened++;
    }
    subIssues.push({
      key: c.key,
      title: c.fields.summary || c.key,
      severity: bucket,
      status: childStatus,
      isDone: childIsDone,
      isReopened: childIsReopened,
    });
  }
  return {
    issueKey,
    title,
    status,
    issueCount: children.length,
    criticalCount: critical,
    majorCount: major,
    minorCount: minor,
    doneCount: done,
    remainingCount: remaining,
    reopenedCount: reopened,
    subIssues,
  };
}

// Fetches the linked ticket's own status, then its sub-issues (children),
// bucketed into Critical/Major/Minor -- preferring a project-defined
// "Severity" field when one exists (see findSeverityFieldId), falling back
// to Priority otherwise -- and done-vs-remaining by statusCategory.key.
// Tries the "child issues" JQL link first (`parent = KEY`, covers sub-tasks
// and, on team-managed projects, sub-issues of any type); falls back to the
// issue's own `subtasks` field -- fetched individually, since the parent
// issue's `subtasks` field doesn't include priority/severity/status -- if
// that search isn't available on the connected instance.
export async function syncFromJira(creds: JiraCreds, ticketLink: string): Promise<JiraSyncResult> {
  const issueKey = parseIssueKey(ticketLink);
  if (!issueKey) {
    throw new JiraApiError('Could not find a Jira issue key in the ticket link (e.g. "NPD-10656")');
  }

  const severityFieldId = await findSeverityFieldId(creds).catch(() => null);
  const childFields = [
    'priority',
    'status',
    'summary',
    ...(severityFieldId ? [severityFieldId] : []),
  ];

  const issue = (await jiraFetch(
    creds,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status,subtasks,summary`,
  )) as JiraIssueLike;
  const status = issue.fields.status?.name || 'Unknown';
  const title = issue.fields.summary || issueKey;

  try {
    const search = (await jiraFetch(creds, '/rest/api/3/search/jql', {
      method: 'POST',
      body: {
        jql: `parent = ${issueKey}`,
        fields: childFields,
        maxResults: 200,
      },
    })) as { issues?: JiraIssueLike[] };
    if (search.issues) {
      return tally(issueKey, title, status, search.issues, severityFieldId);
    }
  } catch {
    // JQL search unavailable on this instance (older API, permissions) --
    // fall back to classic sub-tasks below.
  }

  const subtaskKeys = (issue.fields.subtasks ?? []).map(s => s.key);
  if (subtaskKeys.length === 0) {
    return tally(issueKey, title, status, [], severityFieldId);
  }
  const children = await Promise.all(
    subtaskKeys.map(
      k =>
        jiraFetch(
          creds,
          `/rest/api/3/issue/${encodeURIComponent(k)}?fields=${childFields.join(',')}`,
        ) as Promise<JiraIssueLike>,
    ),
  );
  return tally(issueKey, title, status, children, severityFieldId);
}

// A sync only ever sees THIS MOMENT's status -- syncing twice while a ticket
// sits in Reopened the whole time must not double-count, but going
// Reopened -> Done -> Reopened again is a second, real event and should.
// Called by the cycles routes with the row about to be overwritten (or none,
// for a sub-issue synced for the first time), since that history lives in
// the DB, not in anything the Jira API call itself has access to.
export function withReopenHistory<T extends JiraSubIssueInfo>(
  fresh: T[],
  previous: { issueKey: string; isReopened: boolean; timesReopened: number }[],
): (T & { timesReopened: number })[] {
  const prevByKey = new Map(previous.map(p => [p.issueKey, p]));
  return fresh.map(s => {
    const prev = prevByKey.get(s.key);
    const wasReopened = prev?.isReopened ?? false;
    const priorCount = prev?.timesReopened ?? 0;
    const timesReopened = s.isReopened && !wasReopened ? priorCount + 1 : priorCount;
    return { ...s, timesReopened };
  });
}
