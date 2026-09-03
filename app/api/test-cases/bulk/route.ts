import { prisma } from '@/lib/db';
import { Prisma, Priority, Severity, TestType } from '@prisma/client';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
const SEVERITIES: Severity[] = ['Critical', 'Major', 'Minor'];
const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];

type BulkBody =
  | { action: 'delete'; ids: string[] }
  | {
      action: 'update';
      ids: string[];
      patch: Partial<Record<'priority' | 'severity' | 'type' | 'author', string>>;
    }
  | { action: 'move'; ids: string[]; targetSuiteId?: string; targetFeatureId?: string }
  | { action: 'duplicate'; ids: string[] }
  | { action: 'reorder'; ids: string[] };

// POST /api/test-cases/bulk
//   { action:'delete',    ids:[...] }
//   { action:'update',    ids:[...], patch:{ priority?, severity?, type?, author? } }
//   { action:'move',      ids:[...], targetSuiteId:'...' (or legacy targetFeatureId) }
//   { action:'duplicate', ids:[...] }
//   { action:'reorder',   ids:[...] }  — full sibling list in its new order;
//                                        all ids must share the same parent
export async function POST(req: Request) {
  try {
    const body = await parseJson<BulkBody>(req);
    if (!body || !('action' in body)) return bad('action is required');
    if (!Array.isArray(body.ids) || body.ids.length === 0)
      return bad('ids must be a non-empty array');
    if (body.ids.length > 1000) return bad('max 1000 ids per request');

    switch (body.action) {
      case 'delete': {
        const r = await prisma.testCase.deleteMany({ where: { id: { in: body.ids } } });
        return ok({ deleted: r.count });
      }

      case 'update': {
        const data: Prisma.TestCaseUpdateManyMutationInput = {};
        const p = body.patch ?? {};
        if (p.priority !== undefined) {
          if (!PRIORITIES.includes(p.priority as Priority)) return bad('invalid priority');
          data.priority = p.priority as Priority;
        }
        if (p.severity !== undefined) {
          if (!SEVERITIES.includes(p.severity as Severity)) return bad('invalid severity');
          data.severity = p.severity as Severity;
        }
        if (p.type !== undefined) {
          if (!TYPES.includes(p.type as TestType)) return bad('invalid type');
          data.type = p.type as TestType;
        }
        if (typeof p.author === 'string') data.author = p.author;
        if (Object.keys(data).length === 0) return bad('patch must contain at least one field');

        const r = await prisma.testCase.updateMany({ where: { id: { in: body.ids } }, data });
        return ok({ updated: r.count });
      }

      case 'move': {
        const suiteId = body.targetSuiteId ?? body.targetFeatureId;
        if (!suiteId) return bad('targetSuiteId is required');
        const target = await prisma.suite.findUnique({ where: { id: suiteId } });
        if (!target) return bad('targetSuiteId not found', 404);
        const r = await prisma.testCase.updateMany({
          where: { id: { in: body.ids } },
          data: { suiteId },
        });
        return ok({ moved: r.count });
      }

      case 'duplicate': {
        const sources = await prisma.testCase.findMany({ where: { id: { in: body.ids } } });
        if (sources.length === 0) return ok({ created: 0 });
        const created = await prisma.$transaction(
          sources.map(s =>
            prisma.testCase.create({
              data: {
                title: `${s.title} (copy)`,
                sub: s.sub,
                desc: s.desc,
                steps: s.steps as Prisma.InputJsonValue,
                expected: s.expected,
                priority: s.priority,
                severity: s.severity,
                type: s.type,
                suiteId: s.suiteId,
                author: s.author,
              },
            }),
          ),
        );
        return ok({ created: created.length });
      }

      case 'reorder': {
        const cases = await prisma.testCase.findMany({
          where: { id: { in: body.ids } },
          select: { id: true, portalId: true, moduleId: true, suiteId: true },
        });
        if (cases.length !== body.ids.length) return bad('one or more ids not found', 404);
        const parentKey = (c: (typeof cases)[number]) => c.portalId ?? c.moduleId ?? c.suiteId;
        const firstParent = parentKey(cases[0]);
        if (!cases.every(c => parentKey(c) === firstParent)) {
          return bad('all ids must share the same parent portal/module/suite');
        }
        // Full sibling group must be reordered together, not a subset —
        // otherwise cases left out would keep stale `order` values that
        // collide with the newly-assigned ones.
        const siblingCount = await prisma.testCase.count({
          where: {
            portalId: cases[0].portalId,
            moduleId: cases[0].moduleId,
            suiteId: cases[0].suiteId,
          },
        });
        if (siblingCount !== body.ids.length) {
          return bad('ids must be exactly the current set of sibling cases');
        }

        await prisma.$transaction(
          body.ids.map((id, index) =>
            prisma.testCase.update({ where: { id }, data: { order: index } }),
          ),
        );
        return ok({ reordered: body.ids.length });
      }

      default:
        return bad('unknown action');
    }
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
