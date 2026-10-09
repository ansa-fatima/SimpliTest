import { prisma } from '@/lib/db';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

// POST /api/qa-modules/:id/move -- { direction: 'up' | 'down' }
// Swaps the module's `order` with the immediately-adjacent sibling in the
// same portal. One API call per nudge keeps the UI simple (two button
// clicks walk a module two positions), and keeps every module's order
// value in the dense 0..N-1 range so a later sort is a plain integer
// compare.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<{ direction?: 'up' | 'down' }>(req);
    const direction = body?.direction;
    if (direction !== 'up' && direction !== 'down') {
      return bad('direction must be "up" or "down"');
    }
    const mod = await prisma.qaModule.findUnique({
      where: { id: params.id },
      select: { id: true, portalId: true, order: true },
    });
    if (!mod) return notFound('Module not found');
    const neighbor = await prisma.qaModule.findFirst({
      where: {
        portalId: mod.portalId,
        order: direction === 'up' ? { lt: mod.order } : { gt: mod.order },
      },
      orderBy: { order: direction === 'up' ? 'desc' : 'asc' },
      select: { id: true, order: true },
    });
    if (!neighbor) return ok({ moved: false });
    // Transactional swap -- order is unique within a portal in practice,
    // so a single update would briefly collide on the sibling's value.
    await prisma.$transaction([
      prisma.qaModule.update({ where: { id: mod.id }, data: { order: neighbor.order } }),
      prisma.qaModule.update({ where: { id: neighbor.id }, data: { order: mod.order } }),
    ]);
    return ok({ moved: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
