import { prisma } from '@/lib/db';
import { Prisma, Priority, Severity, TestType } from '@prisma/client';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';
import { projectIdForCaseParent, resolveCaseOption } from '@/lib/testCaseOptions';

type BulkBody =
  | { action: 'delete'; ids: string[] }
  | {
      action: 'update';
      ids: string[];
      patch: Partial<Record<'priority' | 'severity' | 'type' | 'author', string>>;
    }
  | { action: 'move'; ids: string[]; targetSuiteId?: string; targetFeatureId?: string }
  | { action: 'duplicate'; ids: string[]; targetSuiteId?: string }
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
        const p = body.patch ?? {};
        // Prisma excludes a scalar FK from *UpdateInput whenever a @relation
        // is declared on it (customPriorityId/customSeverityId/customTypeId
        // here) -- and updateMany can't touch relations at all. So a custom-
        // option change (connect/disconnect) always needs a per-row
        // TestCaseUpdateInput; a plain enum-literal-only change can still
        // use the cheaper updateMany.
        const relationData: Pick<
          Prisma.TestCaseUpdateInput,
          'customPriority' | 'customSeverity' | 'customType'
        > = {};
        const data: Prisma.TestCaseUpdateManyMutationInput = {};
        let touchesCustomOption = false;

        if (p.priority !== undefined || p.severity !== undefined || p.type !== undefined) {
          // Resolve custom option keys (see lib/options.ts) against whichever
          // workspace the FIRST selected case belongs to -- bulk edit only
          // ever operates on one screen's selection, always the same workspace.
          const first = await prisma.testCase.findUnique({
            where: { id: body.ids[0] },
            select: { portalId: true, moduleId: true, suiteId: true },
          });
          if (!first) return bad('one or more ids not found', 404);
          const projectId = await projectIdForCaseParent(first);
          if (!projectId) return bad('Parent not found');

          if (p.priority !== undefined) {
            const opt = await resolveCaseOption(projectId, 'Priority', p.priority, 'Medium');
            if (!opt) return bad('invalid priority');
            data.priority = opt.enumValue as Priority;
            relationData.customPriority = opt.customOptionId
              ? { connect: { id: opt.customOptionId } }
              : { disconnect: true };
            touchesCustomOption = true;
          }
          if (p.severity !== undefined) {
            const opt = await resolveCaseOption(projectId, 'Severity', p.severity, 'Minor');
            if (!opt) return bad('invalid severity');
            data.severity = opt.enumValue as Severity;
            relationData.customSeverity = opt.customOptionId
              ? { connect: { id: opt.customOptionId } }
              : { disconnect: true };
            touchesCustomOption = true;
          }
          if (p.type !== undefined) {
            const opt = await resolveCaseOption(projectId, 'TestType', p.type, 'Functional');
            if (!opt) return bad('invalid type');
            data.type = opt.enumValue as TestType;
            relationData.customType = opt.customOptionId
              ? { connect: { id: opt.customOptionId } }
              : { disconnect: true };
            touchesCustomOption = true;
          }
        }
        if (typeof p.author === 'string') data.author = p.author;
        if (Object.keys(data).length === 0) return bad('patch must contain at least one field');

        if (touchesCustomOption) {
          const rows = await prisma.$transaction(
            body.ids.map(id =>
              prisma.testCase.update({ where: { id }, data: { ...data, ...relationData } }),
            ),
          );
          return ok({ updated: rows.length });
        }

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

        // No target -- copy stays exactly where the source lives (portal,
        // module, or suite, whichever it's actually attached to). A target
        // always means "attach the copy to this feature", same as `move`.
        let target: { portalId: null; moduleId: null; suiteId: string } | null = null;
        if (body.targetSuiteId) {
          const suite = await prisma.suite.findUnique({ where: { id: body.targetSuiteId } });
          if (!suite) return bad('targetSuiteId not found', 404);
          target = { portalId: null, moduleId: null, suiteId: body.targetSuiteId };
        }

        const created = await prisma.$transaction(
          sources.map(s =>
            prisma.testCase.create({
              data: {
                title: `${s.title} (copy)`,
                sub: s.sub,
                desc: s.desc,
                preconditions: s.preconditions,
                steps: s.steps as Prisma.InputJsonValue,
                expected: s.expected,
                labels: s.labels,
                attachments: s.attachments as Prisma.InputJsonValue,
                priority: s.priority,
                customPriorityId: s.customPriorityId,
                severity: s.severity,
                customSeverityId: s.customSeverityId,
                type: s.type,
                customTypeId: s.customTypeId,
                portalId: target ? target.portalId : s.portalId,
                moduleId: target ? target.moduleId : s.moduleId,
                suiteId: target ? target.suiteId : s.suiteId,
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
