import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

// PATCH /api/qa-features/:id -- rename.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{ name?: string }>(req);
    const name = body?.name?.trim();
    if (!name) return bad('name is required');

    const feat = await prisma.qaFeature.update({
      where: { id: params.id },
      data: { name },
    });
    return ok(feat);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/qa-features/:id
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await prisma.qaFeature.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
