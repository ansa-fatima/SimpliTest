import { prisma } from '@/lib/db';
import { CycleStatus, CycleScopeType } from '@prisma/client';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';
import { deriveSiteUrlFromTicketLink, withReopenHistory, JiraSubIssueInfo } from '@/lib/jira';

interface Ctx {
  params: { id: string };
}

const STATUSES: CycleStatus[] = ['Active', 'Completed', 'Archived'];
const SCOPE_TYPES: CycleScopeType[] = ['All', 'Portal', 'Module', 'Suite', 'Custom'];

// GET /api/cycles/:id
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const cycle = await prisma.testCycle.findUnique({
      where: { id: params.id },
      include: { _count: { select: { runs: true } } },
    });
    if (!cycle) return notFound('Cycle not found');

    // Resolve scope name -- the raw row only has scopeType/scopeId; a
    // refetch (e.g. CycleView refreshing after openCycle) needs the same
    // resolved name the list route already provides, or the header/
    // breadcrumb goes blank the moment this replaces the cached list copy.
    let scopeName: string | null = null;
    if (cycle.scopeType === 'All') scopeName = 'All test cases';
    else if (cycle.scopeType === 'Custom') scopeName = 'Custom selection';
    else if (cycle.scopeType === 'Portal' && cycle.scopeId) {
      const p = await prisma.portal.findUnique({
        where: { id: cycle.scopeId },
        select: { name: true },
      });
      scopeName = p?.name ?? null;
    } else if (cycle.scopeType === 'Module' && cycle.scopeId) {
      const m = await prisma.module.findUnique({
        where: { id: cycle.scopeId },
        select: { name: true },
      });
      scopeName = m?.name ?? null;
    } else if (cycle.scopeType === 'Suite' && cycle.scopeId) {
      const s = await prisma.suite.findUnique({
        where: { id: cycle.scopeId },
        select: { name: true, module: { select: { name: true } } },
      });
      scopeName = s ? `${s.module.name} / ${s.name}` : null;
    }

    return ok({ ...cycle, scopeName });
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/cycles/:id  — rename, change status, or update Manual-mode bookkeeping fields.
// Counts default to 0 if a negative or non-numeric value is sent.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<Record<string, unknown>>(req);
    if (!body) return bad('invalid JSON body');

    const data: Record<string, unknown> = {};

    // Core fields
    if (typeof body.name === 'string') {
      const n = body.name.trim();
      if (!n) return bad('name cannot be empty');
      data.name = n;
    }
    if (typeof body.description === 'string') data.description = body.description;
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as CycleStatus)) return bad('invalid status');
      data.status = body.status;
    }
    if (body.targetDate !== undefined) {
      data.targetDate = body.targetDate ? new Date(body.targetDate as string) : null;
    }
    if (body.completedAt !== undefined) {
      data.completedAt = body.completedAt ? new Date(body.completedAt as string) : null;
    }

    // Scope (Manual-mode quick logs use this to feed the Stability report).
    if (body.scopeType !== undefined) {
      if (!SCOPE_TYPES.includes(body.scopeType as CycleScopeType)) return bad('invalid scopeType');
      const scopeType = body.scopeType as CycleScopeType;
      data.scopeType = scopeType;
      data.scopeId =
        scopeType === 'All' || scopeType === 'Custom' ? null : (body.scopeId as string) || null;
    }

    // Manual-mode free-text fields (passing null clears; passing string sets).
    const stringFields = [
      'portalName',
      'moduleName',
      'featureName',
      'environment',
      'platform',
      'version',
      'cycleCategory',
      'ticketLink',
      'jiraStatus',
      'jiraSiteUrl',
    ] as const;
    for (const k of stringFields) {
      const v = body[k];
      if (v === null) data[k] = null;
      else if (typeof v === 'string') data[k] = v.trim() || null;
    }

    // Set by "Sync from Jira" alongside jiraStatus/the count fields above.
    if (body.jiraSyncedAt !== undefined) {
      data.jiraSyncedAt = body.jiraSyncedAt ? new Date(body.jiraSyncedAt as string) : null;
    }

    // ticketLink being edited directly (not via a sync, which never resends
    // ticketLink) to a full URL -- derive and cache its site so the link
    // keeps resolving even if this gets shortened to a bare key later.
    // An explicit jiraSiteUrl in this same request (an actual sync) wins.
    if (typeof body.ticketLink === 'string' && body.jiraSiteUrl === undefined) {
      const derived = deriveSiteUrlFromTicketLink(body.ticketLink.trim());
      if (derived) data.jiraSiteUrl = derived;
    }

    // Numeric counts (clamped to non-negative integers).
    const countFields = [
      'issueCount',
      'criticalCount',
      'majorCount',
      'minorCount',
      'doneCount',
      'remainingCount',
      'reopenedCount',
      'passedCount',
      'failedCount',
      'blockedCount',
    ] as const;
    for (const k of countFields) {
      const v = body[k];
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        return bad(`${k} must be a non-negative number`);
      }
      data[k] = Math.floor(v);
    }

    // Per-sub-issue snapshot from a fresh "Sync from Jira" -- replaces the
    // whole set for this cycle (not accumulated) so it always reflects only
    // the most recent sync. A request with no jiraSubIssues key at all
    // leaves existing rows untouched, matching every other Jira field above.
    const subIssues = Array.isArray(body.jiraSubIssues)
      ? (body.jiraSubIssues as JiraSubIssueInfo[])
      : undefined;

    if (Object.keys(data).length === 0 && subIssues === undefined) {
      return bad('nothing to update');
    }

    const cycle =
      Object.keys(data).length > 0
        ? await prisma.testCycle.update({ where: { id: params.id }, data })
        : await prisma.testCycle.findUnique({ where: { id: params.id } });
    if (!cycle) return notFound('Cycle not found');

    if (subIssues !== undefined) {
      // Read the rows this sync is about to replace FIRST -- timesReopened
      // has to carry forward across the delete+recreate below, or every
      // re-sync would reset it to 0/1 and a ticket reopened 3-4 times over
      // its life would never show more than "Reopened 1x".
      const previous = await prisma.jiraSubIssue.findMany({
        where: { cycleId: params.id },
        select: { issueKey: true, isReopened: true, timesReopened: true },
      });
      const enriched = withReopenHistory(subIssues, previous);

      await prisma.jiraSubIssue.deleteMany({ where: { cycleId: params.id } });
      if (enriched.length > 0) {
        await prisma.jiraSubIssue.createMany({
          data: enriched.map(s => ({
            projectId: cycle.projectId,
            cycleId: params.id,
            issueKey: s.key,
            title: s.title,
            severity: s.severity,
            status: s.status,
            isDone: s.isDone,
            isReopened: s.isReopened,
            timesReopened: s.timesReopened,
          })),
        });
      }
    }

    return ok(cycle);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/cycles/:id  — permanently delete cycle and all its runs (cascade)
// Use PATCH status='Archived' for soft-delete instead.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await prisma.testCycle.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
