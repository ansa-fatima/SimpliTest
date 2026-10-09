import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

// GET /api/qa-modules?portalId=...   or ?projectId=... for a flat list.
//   Compatibility read: portals endpoint already includes modules, so
//   most UIs don't need this; it's here for the New-cycle form's "all
//   modules in the workspace" dropdown.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const portalId = url.searchParams.get('portalId') || undefined;
    const projectId = url.searchParams.get('projectId') || undefined;
    const where = portalId ? { portalId } : projectId ? { portal: { projectId } } : undefined;
    const modules = await prisma.qaModule.findMany({
      where,
      include: {
        features: { orderBy: { order: 'asc' } },
        portal: { select: { id: true, name: true, projectId: true } },
        _count: { select: { features: true } },
      },
      orderBy: { order: 'asc' },
    });
    return ok(modules);
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/qa-modules -- { name, portalId }
export async function POST(req: Request) {
  try {
    const body = await parseJson<{ name?: string; portalId?: string }>(req);
    const name = body?.name?.trim();
    const portalId = body?.portalId?.trim();
    if (!name) return bad('name is required');
    if (!portalId) return bad('portalId is required');

    const last = await prisma.qaModule.findFirst({
      where: { portalId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const mod = await prisma.qaModule.create({
      data: { name, portalId, order: (last?.order ?? -1) + 1 },
    });
    return ok(mod, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
