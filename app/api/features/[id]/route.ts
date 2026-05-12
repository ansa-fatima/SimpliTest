import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

// GET /api/features/:id
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const feat = await prisma.feature.findUnique({
      where: { id: params.id },
      include: {
        module: { select: { id: true, name: true } },
        _count: { select: { testCases: true } },
      },
    });
    if (!feat) return notFound('Feature not found');
    return ok(feat);
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/features/:id — rename and/or move to a different module
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{ name?: string; moduleId?: string }>(req);
    const data: { name?: string; moduleId?: string } = {};
    if (body?.name !== undefined) {
      const n = body.name.trim();
      if (!n) return bad('name cannot be empty');
      data.name = n;
    }
    if (body?.moduleId !== undefined) data.moduleId = body.moduleId;
    if (Object.keys(data).length === 0) return bad('nothing to update');

    const feat = await prisma.feature.update({ where: { id: params.id }, data });
    return ok(feat);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/features/:id — cascades to test cases
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await prisma.feature.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
