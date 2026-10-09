import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

// POST /api/qa-features/:id/move -- { direction: 'up' | 'down' }
// Swaps a feature chip's `order` with its neighbor in the same module.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{ direction?: 'up' | 'down' }>(req);
    const direction = body?.direction;
    if (direction !== 'up' && direction !== 'down') {
      return bad('direction must be "up" or "down"');
    }
    const feat = await prisma.qaFeature.findUnique({
      where: { id: params.id },
      select: { id: true, moduleId: true, order: true },
    });
    if (!feat) return notFound('Feature not found');
    const neighbor = await prisma.qaFeature.findFirst({
      where: {
        moduleId: feat.moduleId,
        order: direction === 'up' ? { lt: feat.order } : { gt: feat.order },
      },
      orderBy: { order: direction === 'up' ? 'desc' : 'asc' },
      select: { id: true, order: true },
    });
    if (!neighbor) return ok({ moved: false });
    await prisma.$transaction([
      prisma.qaFeature.update({ where: { id: feat.id }, data: { order: neighbor.order } }),
      prisma.qaFeature.update({ where: { id: neighbor.id }, data: { order: feat.order } }),
    ]);
    return ok({ moved: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
