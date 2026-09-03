import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

// PATCH /api/features/reorder
// Body: { moduleId: string, parentId?: string | null, ids: string[] } — the
// full, newly-ordered list of sibling suite ids under that module (parentId
// null = the module's root suites; parentId set = children of that suite).
// Sets each suite's `order` to its index. Reordering only ever happens
// within one sibling group — moving a suite to a different parent is a
// separate action (the existing bulk-move flow), not this endpoint.
export async function PATCH(req: Request) {
  try {
    const body = await parseJson<{
      moduleId?: string;
      parentId?: string | null;
      ids?: string[];
    }>(req);
    const moduleId = body?.moduleId?.trim();
    const parentId = body?.parentId ?? null;
    const ids = body?.ids;
    if (!moduleId) return bad('moduleId is required');
    if (!Array.isArray(ids) || ids.length === 0) return bad('ids must be a non-empty array');

    const existing = await prisma.suite.findMany({
      where: { moduleId, parentId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map(s => s.id));
    if (ids.length !== existing.length || !ids.every(id => existingIds.has(id))) {
      return bad('ids must be exactly the current set of sibling suites');
    }

    await prisma.$transaction(
      ids.map((id, index) => prisma.suite.update({ where: { id }, data: { order: index } })),
    );
    return ok({ reordered: ids.length });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
