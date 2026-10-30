import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, bad, notFound, serverError } from '@/lib/api';
import { parseFolderRef } from '@/lib/caseLink';

export const dynamic = 'force-dynamic';

// GET /api/folder-link?ref=s:<id>
// Which workspace a shared folder link points into, so the app can switch to it
// before opening the folder. Only answers for workspaces the caller belongs to.
export async function GET(req: Request) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;
  try {
    const f = parseFolderRef(new URL(req.url).searchParams.get('ref'));
    if (!f) return bad('That folder link is not valid.');

    let projectId: string | undefined;
    if (f.kind === 'portal') {
      projectId = (
        await prisma.portal.findUnique({ where: { id: f.id }, select: { projectId: true } })
      )?.projectId;
    } else if (f.kind === 'module') {
      projectId = (
        await prisma.module.findUnique({
          where: { id: f.id },
          select: { portal: { select: { projectId: true } } },
        })
      )?.portal.projectId;
    } else {
      projectId = (
        await prisma.suite.findUnique({
          where: { id: f.id },
          select: { module: { select: { portal: { select: { projectId: true } } } } },
        })
      )?.module.portal.projectId;
    }
    if (!projectId) return notFound('That folder no longer exists.');

    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId } },
    });
    if (!membership && userOrRes.role !== 'SuperAdmin')
      return bad('You do not have access to that folder.', 403);
    return ok({ projectId });
  } catch (e) {
    return serverError(e);
  }
}
