import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

// GET /api/qa-portals?projectId=...
//   List the project's QA portals, each with its modules (ordered) and each
//   module's features (ordered). Powers the Portal > Module > Feature tree
//   on the Settings > Modules & Features page.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get('projectId') || undefined;
    if (!projectId) return bad('projectId is required');

    const portals = await prisma.qaPortal.findMany({
      where: { projectId },
      include: {
        modules: {
          orderBy: { order: 'asc' },
          include: {
            features: { orderBy: { order: 'asc' } },
            _count: { select: { features: true } },
          },
        },
        _count: { select: { modules: true } },
      },
      orderBy: { order: 'asc' },
    });
    return ok(portals);
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/qa-portals -- { name, projectId }
export async function POST(req: Request) {
  try {
    const body = await parseJson<{ name?: string; projectId?: string }>(req);
    const name = body?.name?.trim();
    const projectId = body?.projectId?.trim();
    if (!name) return bad('name is required');
    if (!projectId) return bad('projectId is required');

    const last = await prisma.qaPortal.findFirst({
      where: { projectId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const portal = await prisma.qaPortal.create({
      data: { name, projectId, order: (last?.order ?? -1) + 1 },
    });
    return ok(portal, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
