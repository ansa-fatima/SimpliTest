import { prisma } from '@/lib/db';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { syncFromJira, JiraApiError } from '@/lib/jira';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

// POST /api/projects/:id/integrations/jira/fetch — "Sync from Jira" preview.
// Body: { ticketLink }. Parses the issue key out of ticketLink, fetches the
// ticket's status and its sub-issues from Jira, and returns the tallied
// counts WITHOUT writing anything -- the caller (NewCycleModal) applies the
// result to its own form state, so this works identically for a brand-new
// unsaved cycle and an existing one being re-synced; either way the normal
// create/PATCH cycle routes are what actually persist it. Any workspace
// member may sync (same as creating a quick log), not just Settings holders.
export async function POST(req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
    });
    if (!membership) return bad('Not a member of this workspace', 403);

    const body = await parseJson<{ ticketLink?: string }>(req);
    const ticketLink = body?.ticketLink?.trim();
    if (!ticketLink) return bad('ticketLink is required');

    const conn = await prisma.jiraConnection.findUnique({ where: { projectId: params.id } });
    if (!conn) return bad('Connect Jira in Settings > Integrations first', 409);

    try {
      const result = await syncFromJira(
        { siteUrl: conn.siteUrl, email: conn.email, apiToken: conn.apiToken },
        ticketLink,
      );
      // Cache the site this sync used alongside the result -- see
      // TestCycle.jiraSiteUrl -- so the caller can persist it and keep the
      // ticket link resolvable even after this connection is later removed.
      return ok({ ...result, siteUrl: conn.siteUrl });
    } catch (e) {
      if (e instanceof JiraApiError)
        return bad(e.message, e.status && e.status < 500 ? e.status : 400);
      throw e;
    }
  } catch (e) {
    return serverError(e);
  }
}
