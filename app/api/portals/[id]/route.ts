import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

// GET /api/portals/:id
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const portal = await prisma.portal.findUnique({
      where: { id: params.id },
      include: {
        modules: {
          orderBy: { name: 'asc' },
          include: { suites: { orderBy: { name: 'asc' } } },
        },
      },
    });
    if (!portal) return notFound('Portal not found');
    return ok(portal);
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/portals/:id — rename or update icon
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{ name?: string; icon?: string | null; slug?: string }>(req);
    const data: { name?: string; icon?: string | null; slug?: string } = {};
    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name) return bad('name cannot be empty');
      data.name = name;
    }
    if (body?.icon !== undefined) data.icon = body.icon || null;
    if (typeof body?.slug === 'string') data.slug = body.slug.trim();
    if (Object.keys(data).length === 0) return bad('nothing to update');

    const portal = await prisma.portal.update({
      where: { id: params.id },
      data,
    });
    return ok(portal);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/portals/:id — cascades to modules, suites, test cases
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await prisma.portal.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
