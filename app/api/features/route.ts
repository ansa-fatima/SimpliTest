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

// POST /api/features — create a suite at the module root, or nested under another suite.
// Body: { name, moduleId, parentSuiteId? }
//   • Without parentSuiteId → new top-level suite under the given module.
//   • With parentSuiteId    → new sub-folder under that suite (inherits moduleId).
export async function POST(req: Request) {
  try {
    const body = await parseJson<{
      name?: string;
      moduleId?: string;
      parentSuiteId?: string | null;
    }>(req);
    const name = body?.name?.trim();
    if (!name) return bad('name is required');

    let moduleId = body?.moduleId?.trim() || '';
    let parentId: string | null = null;

    // If a parent suite is given, inherit its moduleId and verify it exists.
    if (body?.parentSuiteId) {
      const parent = await prisma.suite.findUnique({
        where: { id: body.parentSuiteId },
        select: { id: true, moduleId: true },
      });
      if (!parent) return bad('Parent suite not found', 404);
      parentId = parent.id;
      moduleId = parent.moduleId;
    }
    if (!moduleId) return bad('moduleId is required (or pass parentSuiteId)');

    // App-layer uniqueness check inside the same parent (Postgres composite unique
    // can't enforce this cleanly when parentId is NULL because NULL != NULL).
    const sibling = await prisma.suite.findFirst({
      where: {
        moduleId,
        parentId,
        name,
      },
      select: { id: true },
    });
    if (sibling) {
      return bad(
        parentId
          ? 'A subfolder with this name already exists here'
          : 'A suite with this name already exists in this module',
        409,
      );
    }

    const suite = await prisma.suite.create({
      data: { name, moduleId, parentId },
    });
    return ok(suite, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
