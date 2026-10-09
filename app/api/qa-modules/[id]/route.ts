import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

// GET /api/qa-modules/:id -- module + ordered features.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const mod = await prisma.qaModule.findUnique({
      where: { id: params.id },
      include: { features: { orderBy: { order: 'asc' } } },
    });
    if (!mod) return notFound('Module not found');
    return ok(mod);
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/qa-modules/:id -- rename.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{ name?: string }>(req);
    const name = body?.name?.trim();
    if (!name) return bad('name is required');

    const mod = await prisma.qaModule.update({
      where: { id: params.id },
      data: { name },
    });
    return ok(mod);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/qa-modules/:id -- cascades to features.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await prisma.qaModule.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
