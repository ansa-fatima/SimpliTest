import { prisma } from '@/lib/db';
import { ok, notFound, serverError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { fetchParentStatuses, parseIssueKeys, type JiraParentStatus } from '@/lib/jira';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

export const dynamic = 'force-dynamic';

// GET /api/cycles/:id/parent-tickets
// The status of every Jira parent ticket linked on the cycle (ticketLink can
// hold several keys). Live from Jira when the workspace is connected; with no
// connection (or if Jira can't be reached) it falls back to the status saved
// at the last sync, which only ever covers the first ticket.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const userOrRes = await requireUser();
    if (userOrRes instanceof NextResponse) return userOrRes;

    const cycle = await prisma.testCycle.findUnique({
      where: { id: params.id },
      select: { projectId: true, ticketLink: true, jiraStatus: true },
    });
    if (!cycle) return notFound('Cycle not found');

    const keys = parseIssueKeys(cycle.ticketLink);
    if (keys.length === 0) return ok({ items: [], live: false });

    const snapshot = (): JiraParentStatus[] =>
      keys.map((key, i) => ({
        key,
        title: null,
        status: i === 0 ? cycle.jiraStatus : null,
        category: null,
      }));

    const conn = await prisma.jiraConnection.findUnique({ where: { projectId: cycle.projectId } });
    if (!conn) return ok({ items: snapshot(), live: false });

    const items = await fetchParentStatuses(
      { siteUrl: conn.siteUrl, email: conn.email, apiToken: conn.apiToken },
      keys,
    );
    // Nothing readable at all -> show the saved status rather than blanks.
    if (items.every(i => !i.status)) return ok({ items: snapshot(), live: false });
    return ok({ items, live: true });
  } catch (e) {
    return serverError(e);
  }
}
