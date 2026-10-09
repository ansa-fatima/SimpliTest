import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

// POST /api/qa-portals/:id/move -- { direction: 'up' | 'down' }
// Swaps the portal's `order` with the adjacent sibling in the same
// project. See /api/qa-modules/:id/move for the per-portal twin.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{ direction?: 'up' | 'down' }>(req);
    const direction = body?.direction;
    if (direction !== 'up' && direction !== 'down') {
      return bad('direction must be "up" or "down"');
    }
    const portal = await prisma.qaPortal.findUnique({
      where: { id: params.id },
      select: { id: true, projectId: true, order: true },
    });
    if (!portal) return notFound('Portal not found');
    const neighbor = await prisma.qaPortal.findFirst({
      where: {
        projectId: portal.projectId,
        order: direction === 'up' ? { lt: portal.order } : { gt: portal.order },
      },
      orderBy: { order: direction === 'up' ? 'desc' : 'asc' },
      select: { id: true, order: true },
    });
    if (!neighbor) return ok({ moved: false });
    await prisma.$transaction([
      prisma.qaPortal.update({ where: { id: portal.id }, data: { order: neighbor.order } }),
      prisma.qaPortal.update({ where: { id: neighbor.id }, data: { order: portal.order } }),
    ]);
    return ok({ moved: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
