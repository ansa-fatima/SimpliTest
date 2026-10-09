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
        projectKey: true,
        jqlPrefilter: true,
        apiTokenRotatedAt: true,
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
      projectKey: conn.projectKey,
      jqlPrefilter: conn.jqlPrefilter,
      apiTokenRotatedAt: conn.apiTokenRotatedAt,
      autoSyncIntervalMinutes: conn.autoSyncIntervalMinutes,
      autoSyncEnabled: conn.autoSyncEnabled,
      lastSyncAt: conn.lastSyncAt,
      lastSyncCount: conn.lastSyncCount,
    });
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/projects/:id/integrations/jira -- update any of the editable
// Jira-connection fields EXCEPT the token itself. Token rotation goes
// through the dedicated rotate-token sub-route so a stray "Save changes"
// can't blank the credential by sending apiToken: "". Caller must hold
// the Settings permission.
export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'settings');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await parseJson<{
      siteUrl?: string;
      email?: string;
      projectKey?: string | null;
      jqlPrefilter?: string | null;
      autoSyncIntervalMinutes?: number;
      autoSyncEnabled?: boolean;
    }>(req);
    const data: Record<string, unknown> = {};

    if (typeof body?.siteUrl === 'string') {
      const siteUrl = body.siteUrl.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/.+/.test(siteUrl))
        return bad('Jira instance URL must be a full https:// URL');
      data.siteUrl = siteUrl;
    }
    if (typeof body?.email === 'string') {
      const email = body.email.trim();
      if (!email) return bad('Service account email cannot be empty');
      data.email = email;
    }
    if (body?.projectKey !== undefined) {
      const pk = (body.projectKey ?? '').trim().toUpperCase();
      if (pk && !/^[A-Z][A-Z0-9]+$/.test(pk))
        return bad('Project key must be upper-case letters/digits (e.g. NPD)');
      data.projectKey = pk || null;
    }
    if (body?.jqlPrefilter !== undefined) {
      const jql = (body.jqlPrefilter ?? '').trim();
      data.jqlPrefilter = jql || null;
    }
    if (typeof body?.autoSyncIntervalMinutes === 'number') {
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
        siteUrl: true,
        email: true,
        projectKey: true,
        jqlPrefilter: true,
        autoSyncIntervalMinutes: true,
        autoSyncEnabled: true,
        apiTokenRotatedAt: true,
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
    const body = await parseJson<{
      siteUrl?: string;
      email?: string;
      apiToken?: string;
      autoSyncIntervalMinutes?: number;
      autoSyncEnabled?: boolean;
    }>(req);
    const siteUrl = body?.siteUrl?.trim().replace(/\/+$/, '');
    const email = body?.email?.trim();
    const apiToken = body?.apiToken?.trim();
    if (!siteUrl || !/^https?:\/\/.+/.test(siteUrl)) {
      return bad('A valid Jira site URL is required (e.g. https://your-team.atlassian.net)');
    }
    if (!email) return bad('email is required');
    if (!apiToken) return bad('apiToken is required');

    // Auto-sync defaults chosen at setup time -- caller may send either /
    // both / neither; absent values fall through to the schema defaults
    // (every 15 minutes, auto-sync on).
    const allowed = [5, 15, 30, 60, 120, 360, 1440];
    let autoSyncIntervalMinutes: number | undefined;
    if (typeof body?.autoSyncIntervalMinutes === 'number') {
      if (!allowed.includes(body.autoSyncIntervalMinutes))
        return bad(`autoSyncIntervalMinutes must be one of: ${allowed.join(', ')}`);
      autoSyncIntervalMinutes = body.autoSyncIntervalMinutes;
    }
    const autoSyncEnabled =
      typeof body?.autoSyncEnabled === 'boolean' ? body.autoSyncEnabled : undefined;

    try {
      await testConnection({ siteUrl, email, apiToken });
    } catch (e) {
      if (e instanceof JiraApiError)
        return bad(e.message, e.status && e.status < 500 ? e.status : 400);
      throw e;
    }

    const conn = await prisma.jiraConnection.upsert({
      where: { projectId: params.id },
      create: {
        projectId: params.id,
        siteUrl,
        email,
        apiToken,
        connectedById: guard.id,
        ...(autoSyncIntervalMinutes !== undefined && { autoSyncIntervalMinutes }),
        ...(autoSyncEnabled !== undefined && { autoSyncEnabled }),
        apiTokenRotatedAt: new Date(),
      },
      update: {
        siteUrl,
        email,
        apiToken,
        connectedById: guard.id,
        connectedAt: new Date(),
        apiTokenRotatedAt: new Date(),
        ...(autoSyncIntervalMinutes !== undefined && { autoSyncIntervalMinutes }),
        ...(autoSyncEnabled !== undefined && { autoSyncEnabled }),
      },
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
