import { prisma } from '@/lib/db';
import { Prisma, Priority, Severity, TestType, CaseStatus } from '@prisma/client';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx {
  params: { id: string };
}

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
  suite: { include: { module: { select: { id: true, name: true } } } },
  owner: { select: ownerSelect },
} as const;

// GET /api/test-cases/:id
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const tc = await prisma.testCase.findUnique({
      where: { id: params.id },
      include: caseInclude,
    });
    if (!tc) return notFound('Test case not found');
    return ok(tc);
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/test-cases/:id — partial update
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await parseJson<Record<string, unknown>>(req);
    if (!body) return bad('invalid JSON body');

    const data: Prisma.TestCaseUpdateInput = {};

    if (typeof body.title === 'string') {
      const t = body.title.trim();
      if (!t) return bad('title cannot be empty');
      data.title = t;
    }
    if (typeof body.sub === 'string') data.sub = body.sub;
    if (typeof body.desc === 'string') data.desc = body.desc;
    if (typeof body.expected === 'string') data.expected = body.expected;
    if (body.steps !== undefined) data.steps = body.steps as Prisma.InputJsonValue;
    if (typeof body.author === 'string') data.author = body.author;

    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority as Priority)) return bad('invalid priority');
      data.priority = body.priority as Priority;
    }
    if (body.severity !== undefined) {
      if (!SEVERITIES.includes(body.severity as Severity)) return bad('invalid severity');
      data.severity = body.severity as Severity;
    }
    if (body.type !== undefined) {
      if (!TYPES.includes(body.type as TestType)) return bad('invalid type');
      data.type = body.type as TestType;
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as CaseStatus)) return bad('invalid status');
      data.status = body.status as CaseStatus;
    }
    if (body.ownerId !== undefined) {
      const oid = body.ownerId;
      if (oid === null || oid === '') {
        data.owner = { disconnect: true };
      } else if (typeof oid === 'string') {
        data.owner = { connect: { id: oid } };
      } else {
        return bad('ownerId must be a string or null');
      }
    }
    const newSuiteId =
      typeof body.suiteId === 'string'
        ? body.suiteId
        : typeof body.featureId === 'string'
          ? body.featureId
          : undefined;
    if (newSuiteId) {
      data.suite = { connect: { id: newSuiteId } };
    }

    if (Object.keys(data).length === 0) return bad('nothing to update');

    const tc = await prisma.testCase.update({
      where: { id: params.id },
      data,
      include: caseInclude,
    });
    return ok(tc);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}

// DELETE /api/test-cases/:id
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await prisma.testCase.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
