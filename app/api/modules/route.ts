import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

// GET /api/modules?portalId=...    — list modules in a portal (with their suites)
// GET /api/modules?projectId=...   — list modules across all portals in a project (compat)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const portalId = url.searchParams.get('portalId') || undefined;
    const projectId = url.searchParams.get('projectId') || undefined;

    const where = portalId ? { portalId } : projectId ? { portal: { projectId } } : undefined;

    const modules = await prisma.module.findMany({
      where,
      include: {
        suites: { orderBy: { name: 'asc' } },
        _count: { select: { suites: true } },
      },
      orderBy: { name: 'asc' },
    });
    return ok(modules);
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/modules — create a module inside a portal
export async function POST(req: Request) {
  try {
    const body = await parseJson<{ name?: string; portalId?: string }>(req);
    const name = body?.name?.trim();
    const portalId = body?.portalId?.trim();
    if (!name) return bad('name is required');
    if (!portalId) return bad('portalId is required');

    const mod = await prisma.module.create({ data: { name, portalId } });
    return ok(mod, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
