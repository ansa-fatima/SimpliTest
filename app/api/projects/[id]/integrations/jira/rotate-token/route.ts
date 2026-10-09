import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';
import { requireWorkspacePermission } from '@/lib/auth';
import { testConnection, JiraApiError } from '@/lib/jira';
import { NextResponse } from 'next/server';

interface Ctx {
  params: { id: string };
}

// POST /api/projects/:id/integrations/jira/rotate-token -- replace the
// stored API token. Validates the new credential against Jira BEFORE
// writing (same flow as Connect) so a typo'd rotation can't lock the
// console out of the real one. Settings permission required.
export async function POST(req: Request, { params }: Ctx) {
  const guard = await requireWorkspacePermission(params.id, 'settings');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await parseJson<{ apiToken?: string }>(req);
    const apiToken = body?.apiToken?.trim();
    if (!apiToken) return bad('apiToken is required');

    const existing = await prisma.jiraConnection.findUnique({
      where: { projectId: params.id },
      select: { siteUrl: true, email: true },
    });
    if (!existing) return bad('Jira is not connected for this workspace', 404);

    try {
      await testConnection({
        siteUrl: existing.siteUrl,
        email: existing.email,
        apiToken,
      });
    } catch (e) {
      if (e instanceof JiraApiError)
        return bad(e.message, e.status && e.status < 500 ? e.status : 400);
      throw e;
    }

    const conn = await prisma.jiraConnection.update({
      where: { projectId: params.id },
      data: { apiToken, apiTokenRotatedAt: new Date() },
      select: { apiTokenRotatedAt: true },
    });
    return ok(conn);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
