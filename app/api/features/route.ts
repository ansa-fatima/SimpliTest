import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

// GET /api/features?moduleId=... — list features (optionally scoped)
export async function GET(req: Request) {
  try {
    const moduleId = new URL(req.url).searchParams.get('moduleId') || undefined;
    const features = await prisma.feature.findMany({
      where: moduleId ? { moduleId } : undefined,
      include: {
        module: { select: { id: true, name: true } },
        _count: { select: { testCases: true } },
      },
      orderBy: [{ moduleId: 'asc' }, { name: 'asc' }],
    });
    return ok(features);
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/features — create a feature inside a module
export async function POST(req: Request) {
  try {
    const body = await parseJson<{ name?: string; moduleId?: string }>(req);
    const name = body?.name?.trim();
    const moduleId = body?.moduleId?.trim();
    if (!name) return bad('name is required');
    if (!moduleId) return bad('moduleId is required');

    const feat = await prisma.feature.create({ data: { name, moduleId } });
    return ok(feat, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
