import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { fetchIssueText, JiraApiError, parseIssueKey } from '@/lib/jira';

export const dynamic = 'force-dynamic';

interface Ctx {
  params: { id: string };
}

// POST /api/projects/:id/integrations/jira/issue-text  { ticketLink }
// Returns a ticket's title + description as plain text so the "Generate with
// AI" panel can use it as the requirement. Read-only; any workspace member.
export async function POST(req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;
  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
    });
    if (!membership && userOrRes.role !== 'SuperAdmin')
      return bad('Not a member of this workspace', 403);

    const body = await parseJson<{ ticketLink?: string }>(req);
    const key = parseIssueKey(body?.ticketLink?.trim());
    if (!key) return bad('Enter a Jira ticket key or link, like NPD-11800.');

    const conn = await prisma.jiraConnection.findUnique({ where: { projectId: params.id } });
    if (!conn) return bad('Connect Jira in Settings > Integrations first.', 409);

    try {
      const issue = await fetchIssueText(
        {
          siteUrl: conn.siteUrl,
          email: conn.email,
          apiToken: conn.apiToken,
        },
        key,
      );
      return ok(issue);
    } catch (e) {
      if (e instanceof JiraApiError) {
        if (e.status === 404) return bad(`Ticket ${key} was not found in Jira.`, 404);
        return bad(e.message, e.status && e.status < 500 ? e.status : 400);
      }
      throw e;
    }
  } catch (e) {
    return serverError(e);
  }
}
