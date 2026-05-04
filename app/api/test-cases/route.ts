import { prisma } from '@/lib/db';
import { Prisma, Priority, Severity, TestType } from '@prisma/client';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
const SEVERITIES: Severity[] = ['Critical', 'Major', 'Minor'];
const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];

// GET /api/test-cases
//   ?search=...        full-text-ish: title / sub / desc / expected (case-insensitive)
//   ?moduleId=...      filter by module
//   ?featureId=...     filter by feature (overrides moduleId)
//   ?priority=High     repeatable (?priority=High&priority=Medium)
//   ?severity=Critical repeatable
//   ?type=Functional   repeatable
//   ?page=1&pageSize=50
//   ?sort=caseNum|title|createdAt|updatedAt   (default: caseNum)
//   ?order=asc|desc                            (default: desc)
//
// 1.7 — search/filter is the same endpoint with query params (no separate route).
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const search = sp.get('search')?.trim();
    const featureId = sp.get('featureId') || undefined;
    const moduleId = sp.get('moduleId') || undefined;

    const priorities = sp.getAll('priority').filter((p): p is Priority => PRIORITIES.includes(p as Priority));
    const severities = sp.getAll('severity').filter((s): s is Severity => SEVERITIES.includes(s as Severity));
    const types = sp.getAll('type').filter((t): t is TestType => TYPES.includes(t as TestType));

    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') || '50', 10) || 50));

    const sortField = ['caseNum', 'title', 'createdAt', 'updatedAt'].includes(sp.get('sort') || '')
      ? (sp.get('sort') as 'caseNum' | 'title' | 'createdAt' | 'updatedAt')
      : 'caseNum';
    const order: 'asc' | 'desc' = sp.get('order') === 'asc' ? 'asc' : 'desc';

    const where: Prisma.TestCaseWhereInput = {};
    if (featureId) where.featureId = featureId;
    else if (moduleId) where.feature = { moduleId };
    if (priorities.length) where.priority = { in: priorities };
    if (severities.length) where.severity = { in: severities };
    if (types.length) where.type = { in: types };
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { sub: { contains: search, mode: 'insensitive' } },
        { desc: { contains: search, mode: 'insensitive' } },
        { expected: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.testCase.findMany({
        where,
        include: { feature: { include: { module: { select: { id: true, name: true } } } } },
        orderBy: { [sortField]: order },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.testCase.count({ where }),
    ]);

    return ok({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (e) { return serverError(e); }
}

// POST /api/test-cases — create
export async function POST(req: Request) {
  try {
    const body = await parseJson<{
      title?: string; sub?: string; desc?: string; expected?: string;
      steps?: unknown; priority?: Priority; severity?: Severity; type?: TestType;
      featureId?: string; author?: string;
    }>(req);

    const title = body?.title?.trim();
    if (!title) return bad('title is required');
    if (!body?.featureId) return bad('featureId is required');
    if (!body?.priority || !PRIORITIES.includes(body.priority)) return bad('priority must be High|Medium|Low');
    if (!body?.severity || !SEVERITIES.includes(body.severity)) return bad('severity must be Critical|Major|Minor');
    if (!body?.type || !TYPES.includes(body.type)) return bad('type must be Functional|Regression|Smoke|Sanity|UI|API');

    const tc = await prisma.testCase.create({
      data: {
        title,
        sub: body.sub ?? body.desc?.split('.')[0] ?? title,
        desc: body.desc ?? '',
        steps: (body.steps ?? []) as Prisma.InputJsonValue,
        expected: body.expected ?? '',
        priority: body.priority,
        severity: body.severity,
        type: body.type,
        featureId: body.featureId,
        author: body.author ?? '',
      },
      include: { feature: { include: { module: { select: { id: true, name: true } } } } },
    });
    return ok(tc, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
