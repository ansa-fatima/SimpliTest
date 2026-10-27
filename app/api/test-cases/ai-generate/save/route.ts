import { NextResponse } from 'next/server';
import { Prisma, Priority, Severity, TestType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { caseWriteDenied } from '@/lib/caseAccess';
import { listWorkspaceOptions } from '@/lib/options';
import { projectIdForCaseParent, resolveCaseOption } from '@/lib/testCaseOptions';

export const dynamic = 'force-dynamic';

type ParentType = 'portal' | 'module' | 'suite';

interface CaseInput {
  title: string;
  desc?: string;
  preconditions?: string;
  steps: string[];
  expected?: string;
  priority: string; // option NAME, as shown in the preview
  severity: string;
  type: string;
  labels?: string[];
}

// The fields an "update existing" decision may overwrite, one by one.
const UPDATABLE = [
  'title',
  'desc',
  'preconditions',
  'steps',
  'expected',
  'priority',
  'severity',
  'type',
  'labels',
] as const;
type Updatable = (typeof UPDATABLE)[number];

type Decision =
  | { kind: 'create'; case: CaseInput }
  | { kind: 'update'; existingId: string; case: CaseInput; fields: Updatable[] }
  | { kind: 'replace'; existingId: string; case: CaseInput }
  | { kind: 'skip' };

interface Body {
  parentType?: ParentType;
  parentId?: string;
  decisions?: Decision[];
}

class SaveError extends Error {}

// POST /api/test-cases/ai-generate/save
// Applies the user's per-case decisions from the AI preview in ONE transaction,
// so a failure on case 5 never leaves cases 1-4 half-saved. The response carries
// what is needed to undo the batch (see ../undo).
export async function POST(req: Request) {
  try {
    const userOrRes = await requireUser();
    if (userOrRes instanceof NextResponse) return userOrRes;
    const user = userOrRes;

    const body = await parseJson<Body>(req);
    if (!body) return bad('Invalid request body');
    const { parentType, parentId } = body;
    if (!parentType || !['portal', 'module', 'suite'].includes(parentType) || !parentId)
      return bad('Pick a portal, module or suite for the new cases.');
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];
    if (decisions.length === 0) return bad('Nothing to save.');
    if (decisions.length > 50) return bad('Too many cases in one save (50 max).');

    const parent = {
      portalId: parentType === 'portal' ? parentId : null,
      moduleId: parentType === 'module' ? parentId : null,
      suiteId: parentType === 'suite' ? parentId : null,
    };
    const projectId = await projectIdForCaseParent(parent);
    if (!projectId) return bad('That location no longer exists.', 404);
    const denied = await caseWriteDenied(user, projectId);
    if (denied) return bad(denied.message, denied.status);

    // name -> option key, per category, for THIS workspace.
    const [prio, sev, typ] = await Promise.all([
      listWorkspaceOptions(projectId, 'Priority'),
      listWorkspaceOptions(projectId, 'Severity'),
      listWorkspaceOptions(projectId, 'TestType'),
    ]);
    const keyByName = (list: { key: string; name: string }[], name: string) =>
      list.find(o => o.name.toLowerCase() === (name ?? '').trim().toLowerCase())?.key;

    const resolveOptions = async (c: CaseInput) => {
      const p = await resolveCaseOption(
        projectId,
        'Priority',
        keyByName(prio, c.priority),
        'Medium',
      );
      const s = await resolveCaseOption(projectId, 'Severity', keyByName(sev, c.severity), 'Minor');
      const t = await resolveCaseOption(
        projectId,
        'TestType',
        keyByName(typ, c.type),
        'Functional',
      );
      if (!p || !s || !t)
        throw new SaveError(
          `"${c.title}": priority, severity or type is not valid for this workspace.`,
        );
      return { p, s, t };
    };

    const cleanSteps = (steps: unknown): string[] =>
      (Array.isArray(steps) ? steps : [])
        .map(x => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean)
        .slice(0, 30);
    const cleanLabels = (l: unknown): string[] =>
      (Array.isArray(l) ? l : [])
        .map(x => String(x).trim())
        .filter(Boolean)
        .slice(0, 10);

    const result = await prisma.$transaction(async tx => {
      const created: string[] = [];
      const updated: { id: string; before: Record<string, unknown> }[] = [];
      let skipped = 0;

      let order =
        ((
          await tx.testCase.findFirst({
            where: parent,
            orderBy: { order: 'desc' },
            select: { order: true },
          })
        )?.order ?? -1) + 1;
      const titlesHere = new Set(
        (await tx.testCase.findMany({ where: parent, select: { title: true } })).map(t =>
          t.title.toLowerCase(),
        ),
      );

      for (const d of decisions) {
        if (d.kind === 'skip') {
          skipped++;
          continue;
        }
        const c = d.case;
        const title = (c?.title ?? '').trim();
        const steps = cleanSteps(c?.steps);
        if (!title || steps.length === 0)
          throw new SaveError('Every saved case needs a title and at least one step.');

        if (d.kind === 'create') {
          const { p, s, t } = await resolveOptions(c);
          // Never create a second case with exactly the same title in one place.
          let finalTitle = title;
          for (let n = 2; titlesHere.has(finalTitle.toLowerCase()); n++)
            finalTitle = `${title} (${n})`;
          titlesHere.add(finalTitle.toLowerCase());
          const row = await tx.testCase.create({
            data: {
              title: finalTitle,
              sub: (c.desc ?? '').split('.')[0] || finalTitle,
              desc: c.desc ?? '',
              preconditions: c.preconditions ?? '',
              steps: steps as Prisma.InputJsonValue,
              expected: c.expected ?? '',
              priority: p.enumValue as Priority,
              customPriorityId: p.customOptionId,
              severity: s.enumValue as Severity,
              customSeverityId: s.customOptionId,
              type: t.enumValue as TestType,
              customTypeId: t.customOptionId,
              status: 'Active',
              ...parent,
              author: user.name || user.username,
              order: order++,
              labels: cleanLabels(c.labels),
            },
            select: { id: true },
          });
          created.push(row.id);
          continue;
        }

        // update / replace: the target must be a case in this same workspace.
        const existing = await tx.testCase.findUnique({
          where: { id: d.existingId },
          select: {
            id: true,
            title: true,
            desc: true,
            preconditions: true,
            steps: true,
            expected: true,
            labels: true,
            priority: true,
            severity: true,
            type: true,
            customPriorityId: true,
            customSeverityId: true,
            customTypeId: true,
            portalId: true,
            moduleId: true,
            suiteId: true,
          },
        });
        if (!existing) throw new SaveError('One of the cases to update no longer exists.');
        const existingProject = await projectIdForCaseParent(existing);
        if (existingProject !== projectId)
          throw new SaveError('A case to update is in a different workspace.');

        const fields: Updatable[] =
          d.kind === 'replace'
            ? ['desc', 'preconditions', 'steps', 'expected']
            : (d.fields ?? []).filter((f): f is Updatable =>
                (UPDATABLE as readonly string[]).includes(f),
              );
        if (fields.length === 0) {
          skipped++;
          continue;
        }

        const data: Prisma.TestCaseUncheckedUpdateInput = {};
        const before: Record<string, unknown> = {};
        for (const f of fields) {
          if (f === 'title') {
            before.title = existing.title;
            data.title = title;
          } else if (f === 'desc') {
            before.desc = existing.desc;
            data.desc = c.desc ?? '';
          } else if (f === 'preconditions') {
            before.preconditions = existing.preconditions;
            data.preconditions = c.preconditions ?? '';
          } else if (f === 'steps') {
            before.steps = existing.steps;
            data.steps = steps as Prisma.InputJsonValue;
          } else if (f === 'expected') {
            before.expected = existing.expected;
            data.expected = c.expected ?? '';
          } else if (f === 'labels') {
            before.labels = existing.labels;
            data.labels = cleanLabels(c.labels);
          } else {
            const { p, s, t } = await resolveOptions(c);
            if (f === 'priority') {
              before.priority = existing.priority;
              before.customPriorityId = existing.customPriorityId;
              data.priority = p.enumValue as Priority;
              data.customPriorityId = p.customOptionId;
            } else if (f === 'severity') {
              before.severity = existing.severity;
              before.customSeverityId = existing.customSeverityId;
              data.severity = s.enumValue as Severity;
              data.customSeverityId = s.customOptionId;
            } else {
              before.type = existing.type;
              before.customTypeId = existing.customTypeId;
              data.type = t.enumValue as TestType;
              data.customTypeId = t.customOptionId;
            }
          }
        }
        await tx.testCase.update({ where: { id: existing.id }, data });
        updated.push({ id: existing.id, before });
      }
      return { created, updated, skipped };
    });

    return ok({
      created: result.created.length,
      updated: result.updated.length,
      skipped: result.skipped,
      undo: { created: result.created, updated: result.updated },
    });
  } catch (e) {
    if (e instanceof SaveError) return bad(e.message, 422);
    return serverError(e);
  }
}
