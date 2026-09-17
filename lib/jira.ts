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

interface JiraIssueFields {
  status?: { name?: string; statusCategory?: { key?: string } };
  priority?: { name?: string };
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

export interface JiraSyncResult {
  issueKey: string;
  status: string;
  issueCount: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  doneCount: number;
  remainingCount: number;
}

function tally(
  issueKey: string,
  status: string,
  children: { fields: JiraIssueFields }[],
  severityFieldId: string | null,
): JiraSyncResult {
  let critical = 0;
  let major = 0;
  let minor = 0;
  let done = 0;
  let remaining = 0;
  for (const c of children) {
    const bucket = bucketOf(c.fields, severityFieldId);
    if (bucket === 'Critical') critical++;
    else if (bucket === 'Major') major++;
    else minor++;
    if (isDone(c.fields.status?.statusCategory?.key)) done++;
    else remaining++;
  }
  return {
    issueKey,
    status,
    issueCount: children.length,
    criticalCount: critical,
    majorCount: major,
    minorCount: minor,
    doneCount: done,
    remainingCount: remaining,
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
  const childFields = ['priority', 'status', ...(severityFieldId ? [severityFieldId] : [])];

  const issue = (await jiraFetch(
    creds,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status,subtasks`,
  )) as JiraIssueLike;
  const status = issue.fields.status?.name || 'Unknown';

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
      return tally(issueKey, status, search.issues, severityFieldId);
    }
  } catch {
    // JQL search unavailable on this instance (older API, permissions) --
    // fall back to classic sub-tasks below.
  }

  const subtaskKeys = (issue.fields.subtasks ?? []).map(s => s.key);
  if (subtaskKeys.length === 0) {
    return tally(issueKey, status, [], severityFieldId);
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
  return tally(issueKey, status, children, severityFieldId);
}
