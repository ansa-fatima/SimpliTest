import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

// PATCH /api/qa-portals/:id -- rename.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{ name?: string }>(req);
    const name = body?.name?.trim();
    if (!name) return bad('name is required');

    const portal = await prisma.qaPortal.update({
      where: { id: params.id },
      data: { name },
    });
    return ok(portal);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/qa-portals/:id -- cascades to modules + features.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await prisma.qaPortal.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
