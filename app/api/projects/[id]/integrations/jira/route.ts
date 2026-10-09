import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';
import { requireUser, requireWorkspacePermission } from '@/lib/auth';
import { testConnection, JiraApiError } from '@/lib/jira';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

// GET /api/projects/:id/integrations/jira — connection status. Any member
// can see whether Jira is connected (needed to show/hide the "Sync from
// Jira" action); `apiToken` is never included here or anywhere else.
export async function GET(_req: Request, { params }: Ctx) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: params.id } },
    });
    if (!membership) return bad('Not a member of this workspace', 403);

    const conn = await prisma.jiraConnection.findUnique({
      where: { projectId: params.id },
      select: {
        siteUrl: true,
        email: true,
        connectedAt: true,
        connectedBy: { select: { name: true, username: true } },
        autoSyncIntervalMinutes: true,
        autoSyncEnabled: true,
        lastSyncAt: true,
        lastSyncCount: true,
      },
    });
    if (!conn) return ok({ connected: false });

    return ok({
      connected: true,
      siteUrl: conn.siteUrl,
      email: conn.email,
      connectedAt: conn.connectedAt,
      connectedByName: conn.connectedBy?.name || conn.connectedBy?.username || null,
      autoSyncIntervalMinutes: conn.autoSyncIntervalMinutes,
      autoSyncEnabled: conn.autoSyncEnabled,
      lastSyncAt: conn.lastSyncAt,
      lastSyncCount: conn.lastSyncCount,
    });
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/projects/:id/integrations/jira -- update auto-sync fields.
// Body: { autoSyncIntervalMinutes?, autoSyncEnabled? }. Does NOT touch
// credentials -- a toggle flip shouldn't let a caller change the token.
export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'settings');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await parseJson<{
      autoSyncIntervalMinutes?: number;
      autoSyncEnabled?: boolean;
    }>(req);
    const data: {
      autoSyncIntervalMinutes?: number;
      autoSyncEnabled?: boolean;
    } = {};
    if (typeof body?.autoSyncIntervalMinutes === 'number') {
      // Supported presets only -- the UI dropdown matches, so a user
      // can't pick something the background job doesn't honour.
      const allowed = [5, 15, 30, 60, 120, 360, 1440];
      if (!allowed.includes(body.autoSyncIntervalMinutes))
        return bad(`autoSyncIntervalMinutes must be one of: ${allowed.join(', ')}`);
      data.autoSyncIntervalMinutes = body.autoSyncIntervalMinutes;
    }
    if (typeof body?.autoSyncEnabled === 'boolean') {
      data.autoSyncEnabled = body.autoSyncEnabled;
    }
    if (Object.keys(data).length === 0) return bad('No settings to update');

    const conn = await prisma.jiraConnection.update({
      where: { projectId: params.id },
      data,
      select: {
        autoSyncIntervalMinutes: true,
        autoSyncEnabled: true,
        lastSyncAt: true,
        lastSyncCount: true,
      },
    });
    return ok(conn);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// POST /api/projects/:id/integrations/jira — connect. Body: { siteUrl,
// email, apiToken }. Validates the credentials against Jira before saving
// anything, so a typo doesn't silently "connect".
export async function POST(req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'settings');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await parseJson<{ siteUrl?: string; email?: string; apiToken?: string }>(req);
    const siteUrl = body?.siteUrl?.trim().replace(/\/+$/, '');
    const email = body?.email?.trim();
    const apiToken = body?.apiToken?.trim();
    if (!siteUrl || !/^https?:\/\/.+/.test(siteUrl)) {
      return bad('A valid Jira site URL is required (e.g. https://your-team.atlassian.net)');
    }
    if (!email) return bad('email is required');
    if (!apiToken) return bad('apiToken is required');

    try {
      await testConnection({ siteUrl, email, apiToken });
    } catch (e) {
      if (e instanceof JiraApiError)
        return bad(e.message, e.status && e.status < 500 ? e.status : 400);
      throw e;
    }

    const conn = await prisma.jiraConnection.upsert({
      where: { projectId: params.id },
      create: { projectId: params.id, siteUrl, email, apiToken, connectedById: guard.id },
      update: { siteUrl, email, apiToken, connectedById: guard.id, connectedAt: new Date() },
    });

    return ok({
      connected: true,
      siteUrl: conn.siteUrl,
      email: conn.email,
      connectedAt: conn.connectedAt,
    });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/projects/:id/integrations/jira — disconnect.
export async function DELETE(_req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'settings');
  if (guard instanceof NextResponse) return guard;

  try {
    await prisma.jiraConnection.deleteMany({ where: { projectId: params.id } });
    return ok({ connected: false });
  } catch (e) {
    return serverError(e);
  }
}
