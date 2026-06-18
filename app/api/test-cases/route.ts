import { prisma } from '@/lib/db';
import { Prisma, Priority, Severity, TestType, CaseStatus } from '@prisma/client';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
const SEVERITIES: Severity[] = ['Critical', 'Major', 'Minor'];
const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];
const STATUSES: CaseStatus[] = ['Active', 'Draft', 'Archived'];

const ownerSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
  avatarUrl: true,
} as const;

const caseInclude = {
  portal: { select: { id: true, name: true, projectId: true } },
  module: {
    select: {
      id: true,
      name: true,
      portal: { select: { id: true, name: true, projectId: true } },
    },
  },
  suite: {
    include: {
      module: {
        select: {
          id: true,
          name: true,
          portal: { select: { id: true, name: true, projectId: true } },
        },
      },
    },
  },
  owner: { select: ownerSelect },
} as const;

// GET /api/test-cases
//   ?search=...        full-text-ish: title / sub / desc / expected (case-insensitive)
//   ?projectId=...     filter by project
//   ?moduleId=...      filter by module (overrides projectId)
//   ?suiteId=... (or legacy ?featureId=...) — filter by suite (overrides above)
//   ?priority=High     repeatable
//   ?severity=Critical repeatable
//   ?type=Functional   repeatable
//   ?page=1&pageSize=50
//   ?sort=caseNum|title|createdAt|updatedAt   (default: caseNum)
//   ?order=asc|desc                            (default: desc)
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const search = sp.get('search')?.trim();
    const suiteId = sp.get('suiteId') || sp.get('featureId') || undefined;
    const moduleId = sp.get('moduleId') || undefined;
    const projectId = sp.get('projectId') || undefined;

    const priorities = sp
      .getAll('priority')
      .filter((p): p is Priority => PRIORITIES.includes(p as Priority));
    const severities = sp
      .getAll('severity')
      .filter((s): s is Severity => SEVERITIES.includes(s as Severity));
    const types = sp.getAll('type').filter((t): t is TestType => TYPES.includes(t as TestType));
    const statuses = sp
      .getAll('status')
      .filter((s): s is CaseStatus => STATUSES.includes(s as CaseStatus));
    const ownerIds = sp.getAll('ownerId').filter(Boolean);
    const portalId = sp.get('portalId') || undefined;

    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(5000, Math.max(1, parseInt(sp.get('pageSize') || '50', 10) || 50));

    const sortField = ['caseNum', 'title', 'createdAt', 'updatedAt'].includes(sp.get('sort') || '')
      ? (sp.get('sort') as 'caseNum' | 'title' | 'createdAt' | 'updatedAt')
      : 'caseNum';
    const order: 'asc' | 'desc' = sp.get('order') === 'asc' ? 'asc' : 'desc';

    // Cases attach to a Portal, Module, OR Suite directly. Filtering at a higher
    // level includes every case nested anywhere underneath. Parent-scope and search
    // are OR-clauses, so we combine them via AND to keep both effective at once.
    const ands: Prisma.TestCaseWhereInput[] = [];
    if (suiteId) {
      ands.push({ suiteId });
    } else if (moduleId) {
      ands.push({ OR: [{ moduleId }, { suite: { moduleId } }] });
    } else if (portalId) {
      ands.push({
        OR: [{ portalId }, { module: { portalId } }, { suite: { module: { portalId } } }],
      });
    } else if (projectId) {
      ands.push({
        OR: [
          { portal: { projectId } },
          { module: { portal: { projectId } } },
          { suite: { module: { portal: { projectId } } } },
        ],
      });
    }
    if (search) {
      ands.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { sub: { contains: search, mode: 'insensitive' } },
          { desc: { contains: search, mode: 'insensitive' } },
          { expected: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.TestCaseWhereInput = ands.length ? { AND: ands } : {};
    if (priorities.length) where.priority = { in: priorities };
    if (severities.length) where.severity = { in: severities };
    if (types.length) where.type = { in: types };
    if (statuses.length) where.status = { in: statuses };
    if (ownerIds.length) where.ownerId = { in: ownerIds };

    const [items, total] = await Promise.all([
      prisma.testCase.findMany({
        where,
        include: caseInclude,
        orderBy: { [sortField]: order },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.testCase.count({ where }),
    ]);

    return ok({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/test-cases — create
export async function POST(req: Request) {
  try {
    const body = await parseJson<{
      title?: string;
      sub?: string;
      desc?: string;
      expected?: string;
      steps?: unknown;
      priority?: Priority;
      severity?: Severity;
      type?: TestType;
      portalId?: string;
      moduleId?: string;
      suiteId?: string;
      featureId?: string; // legacy alias
      author?: string;
      status?: CaseStatus;
      ownerId?: string | null;
      preconditions?: string;
    }>(req);

    const title = body?.title?.trim();
    const suiteId = body?.suiteId ?? body?.featureId ?? null;
    const moduleId = body?.moduleId ?? null;
    const portalId = body?.portalId ?? null;

    // Exactly one parent must be set — Portal OR Module OR Suite.
    const parentCount = [portalId, moduleId, suiteId].filter(Boolean).length;
    if (!title) return bad('title is required');
    if (parentCount === 0) return bad('portalId, moduleId, or suiteId is required');
    if (parentCount > 1) return bad('only one of portalId / moduleId / suiteId may be set');
    if (!body?.priority || !PRIORITIES.includes(body.priority))
      return bad('priority must be High|Medium|Low');
    if (!body?.severity || !SEVERITIES.includes(body.severity))
      return bad('severity must be Critical|Major|Minor');
    if (!body?.type || !TYPES.includes(body.type))
      return bad('type must be Functional|Regression|Smoke|Sanity|UI|API');

    const status: CaseStatus =
      body?.status && STATUSES.includes(body.status) ? body.status : 'Active';

    const tc = await prisma.testCase.create({
      data: {
        title,
        sub: body.sub ?? body.desc?.split('.')[0] ?? title,
        desc: body.desc ?? '',
        preconditions: body.preconditions ?? '',
        steps: (body.steps ?? []) as Prisma.InputJsonValue,
        expected: body.expected ?? '',
        priority: body.priority,
        severity: body.severity,
        type: body.type,
        status,
        portalId,
        moduleId,
        suiteId,
        author: body.author ?? '',
        ownerId: body.ownerId ?? null,
      },
      include: caseInclude,
    });
    return ok(tc, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
