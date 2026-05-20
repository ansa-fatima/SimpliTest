import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'portal'
  );
}

// GET /api/portals?projectId=...  — list portals in a project (with their modules + suites)
export async function GET(req: Request) {
  try {
    const projectId = new URL(req.url).searchParams.get('projectId') || undefined;
    const portals = await prisma.portal.findMany({
      where: projectId ? { projectId } : undefined,
      include: {
        modules: {
          orderBy: { name: 'asc' },
          include: {
            suites: { orderBy: { name: 'asc' } },
            _count: { select: { suites: true } },
          },
        },
        _count: { select: { modules: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return ok(portals);
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/portals — create a portal inside a project
export async function POST(req: Request) {
  try {
    const body = await parseJson<{
      name?: string;
      projectId?: string;
      icon?: string;
      slug?: string;
    }>(req);
    const name = body?.name?.trim();
    const projectId = body?.projectId?.trim();
    const icon = body?.icon?.trim() || null;
    if (!name) return bad('name is required');
    if (!projectId) return bad('projectId is required');

    const portal = await prisma.portal.create({
      data: {
        name,
        projectId,
        icon,
        slug: body?.slug?.trim() || slugify(name),
      },
    });
    return ok(portal, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
