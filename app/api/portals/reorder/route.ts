import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

// PATCH /api/portals/reorder
// Body: { projectId: string, ids: string[] } — the full, newly-ordered list of
// portal ids in that project. Sets each portal's `order` to its index in the
// array. All-or-nothing in one transaction so a partial drag never leaves the
// list in a half-reordered state.
export async function PATCH(req: Request) {
  try {
    const body = await parseJson<{ projectId?: string; ids?: string[] }>(req);
    const projectId = body?.projectId?.trim();
    const ids = body?.ids;
    if (!projectId) return bad('projectId is required');
    if (!Array.isArray(ids) || ids.length === 0) return bad('ids must be a non-empty array');

    const existing = await prisma.portal.findMany({
      where: { projectId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map(p => p.id));
    if (ids.length !== existing.length || !ids.every(id => existingIds.has(id))) {
      return bad('ids must be exactly the current set of portals in this project');
    }

    await prisma.$transaction(
      ids.map((id, index) => prisma.portal.update({ where: { id }, data: { order: index } })),
    );
    return ok({ reordered: ids.length });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
