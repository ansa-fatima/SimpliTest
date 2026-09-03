import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

// PATCH /api/modules/reorder
// Body: { portalId: string, ids: string[] } — the full, newly-ordered list of
// module ids in that portal. Sets each module's `order` to its index.
export async function PATCH(req: Request) {
  try {
    const body = await parseJson<{ portalId?: string; ids?: string[] }>(req);
    const portalId = body?.portalId?.trim();
    const ids = body?.ids;
    if (!portalId) return bad('portalId is required');
    if (!Array.isArray(ids) || ids.length === 0) return bad('ids must be a non-empty array');

    const existing = await prisma.module.findMany({
      where: { portalId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map(m => m.id));
    if (ids.length !== existing.length || !ids.every(id => existingIds.has(id))) {
      return bad('ids must be exactly the current set of modules in this portal');
    }

    await prisma.$transaction(
      ids.map((id, index) => prisma.module.update({ where: { id }, data: { order: index } })),
    );
    return ok({ reordered: ids.length });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
