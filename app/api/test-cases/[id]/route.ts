import { prisma } from '@/lib/db';
import { Prisma, Priority, Severity, TestType } from '@prisma/client';
import { ok, bad, notFound, parseJson, prismaError, serverError } from '@/lib/api';

interface Ctx { params: { id: string } }

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
const SEVERITIES: Severity[] = ['Critical', 'Major', 'Minor'];
const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];

// GET /api/test-cases/:id
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const tc = await prisma.testCase.findUnique({
      where: { id: params.id },
      include: { feature: { include: { module: { select: { id: true, name: true } } } } },
    });
    if (!tc) return notFound('Test case not found');
    return ok(tc);
  } catch (e) { return serverError(e); }
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
    if (typeof body.featureId === 'string') {
      data.feature = { connect: { id: body.featureId } };
    }

    if (Object.keys(data).length === 0) return bad('nothing to update');

    const tc = await prisma.testCase.update({
      where: { id: params.id },
      data,
      include: { feature: { include: { module: { select: { id: true, name: true } } } } },
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
