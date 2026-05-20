import { prisma } from '@/lib/db';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

// GET /api/features?moduleId=... — list suites in a module
// (Endpoint keeps the /features URL for compatibility; data is from Suite model.)
export async function GET(req: Request) {
  try {
    const moduleId = new URL(req.url).searchParams.get('moduleId') || undefined;
    const suites = await prisma.suite.findMany({
      where: moduleId ? { moduleId } : undefined,
      include: {
        module: { select: { id: true, name: true } },
        _count: { select: { testCases: true } },
      },
      orderBy: [{ moduleId: 'asc' }, { name: 'asc' }],
    });
    return ok(suites);
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/features — create a suite inside a module
export async function POST(req: Request) {
  try {
    const body = await parseJson<{ name?: string; moduleId?: string }>(req);
    const name = body?.name?.trim();
    const moduleId = body?.moduleId?.trim();
    if (!name) return bad('name is required');
    if (!moduleId) return bad('moduleId is required');

    const suite = await prisma.suite.create({ data: { name, moduleId } });
    return ok(suite, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
