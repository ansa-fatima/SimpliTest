import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

// POST /api/qa-features -- { name, moduleId } create a feature chip at the
// end of its module's list.
export async function POST(req: Request) {
  try {
    const body = await parseJson<{ name?: string; moduleId?: string }>(req);
    const name = body?.name?.trim();
    const moduleId = body?.moduleId?.trim();
    if (!name) return bad('name is required');
    if (!moduleId) return bad('moduleId is required');

    const last = await prisma.qaFeature.findFirst({
      where: { moduleId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const feat = await prisma.qaFeature.create({
      data: { name, moduleId, order: (last?.order ?? -1) + 1 },
    });
    return ok(feat, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
