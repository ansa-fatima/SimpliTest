import { NextResponse } from 'next/server';
import { Prisma, Priority, Severity, TestType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { caseWriteDenied } from '@/lib/caseAccess';
import {
  normalizeRevision,
  REVISION_FIELDS,
  RevisionError,
  type CaseSnapshot,
  type RevisionField,
} from '@/lib/caseRevision';
import { listWorkspaceOptions } from '@/lib/options';
import { projectIdForCaseParent, resolveCaseOption } from '@/lib/testCaseOptions';

export const dynamic = 'force-dynamic';

interface Body {
  caseId?: string;
  fields?: string[];
  proposed?: unknown;
  baseUpdatedAt?: string;
}

// POST /api/test-cases/ai-update/apply
// Saves the fields the user ticked from an "Improve with AI" suggestion. The
// suggestion is re-checked here (never trusted from the browser), and refused if
// the case was edited by someone else since it was made. The response carries
// `before` values in the shape ../ai-generate/undo accepts.
export async function POST(req: Request) {
  try {
    const userOrRes = await requireUser();
    if (userOrRes instanceof NextResponse) return userOrRes;
    const user = userOrRes;

    const body = await parseJson<Body>(req);
    if (!body) return bad('Invalid request body');
    if (!body.caseId) return bad('Missing test case.');
    const fields = Array.from(
      new Set(
        (Array.isArray(body.fields) ? body.fields : []).filter((f): f is RevisionField =>
          (REVISION_FIELDS as string[]).includes(f),
        ),
      ),
    );
    if (fields.length === 0) return bad('Pick at least one change to apply.');
    const base = body.baseUpdatedAt ? new Date(body.baseUpdatedAt) : null;
    if (!base || Number.isNaN(base.getTime())) return bad('Invalid request body');

    const row = await prisma.testCase.findUnique({
      where: { id: body.caseId },
      include: { customPriority: true, customSeverity: true, customType: true },
    });
    if (!row) return bad('That test case no longer exists.', 404);

    const projectId = await projectIdForCaseParent(row);
    if (!projectId) return bad('That test case has no location.', 404);
    const denied = await caseWriteDenied(user, projectId);
    if (denied) return bad(denied.message, denied.status);

    if (row.updatedAt.getTime() !== base.getTime())
      return bad(
        'This test case was changed after the suggestion was made. Close this and run Improve with AI again.',
        409,
      );

    const [prio, sev, typ] = await Promise.all([
      listWorkspaceOptions(projectId, 'Priority'),
      listWorkspaceOptions(projectId, 'Severity'),
      listWorkspaceOptions(projectId, 'TestType'),
    ]);
    const options = {
      priority: prio.map(o => o.name),
      severity: sev.map(o => o.name),
      type: typ.map(o => o.name),
    };
    const current: CaseSnapshot = {
      title: row.title,
      desc: row.desc,
      preconditions: row.preconditions,
      steps: (Array.isArray(row.steps) ? row.steps : []).filter(
        (s): s is string => typeof s === 'string',
      ),
      expected: row.expected,
      priority: row.customPriority?.name ?? row.priority,
      severity: row.customSeverity?.name ?? row.severity,
      type: row.customType?.name ?? row.type,
      labels: row.labels,
    };

    // Same cleaning + safety checks as when the suggestion was made.
    const { proposed } = normalizeRevision(body.proposed, current, options);
    if (proposed.steps.length === 0) return bad('A test case needs at least one step.', 422);

    const keyByName = (list: { key: string; name: string }[], name: string) =>
      list.find(o => o.name.toLowerCase() === name.trim().toLowerCase())?.key;

    const data: Prisma.TestCaseUncheckedUpdateInput = {};
    const before: Record<string, unknown> = {};
    for (const f of fields) {
      if (f === 'title') {
        before.title = row.title;
        data.title = proposed.title;
      } else if (f === 'desc') {
        before.desc = row.desc;
        data.desc = proposed.desc;
      } else if (f === 'preconditions') {
        before.preconditions = row.preconditions;
        data.preconditions = proposed.preconditions;
      } else if (f === 'steps') {
        before.steps = row.steps;
        data.steps = proposed.steps as Prisma.InputJsonValue;
      } else if (f === 'expected') {
        before.expected = row.expected;
        data.expected = proposed.expected;
      } else if (f === 'labels') {
        before.labels = row.labels;
        data.labels = proposed.labels;
      } else if (f === 'priority') {
        const o = await resolveCaseOption(
          projectId,
          'Priority',
          keyByName(prio, proposed.priority),
          'Medium',
        );
        if (!o) return bad('That priority is not valid for this workspace.', 422);
        before.priority = row.priority;
        before.customPriorityId = row.customPriorityId;
        data.priority = o.enumValue as Priority;
        data.customPriorityId = o.customOptionId;
      } else if (f === 'severity') {
        const o = await resolveCaseOption(
          projectId,
          'Severity',
          keyByName(sev, proposed.severity),
          'Minor',
        );
        if (!o) return bad('That severity is not valid for this workspace.', 422);
        before.severity = row.severity;
        before.customSeverityId = row.customSeverityId;
        data.severity = o.enumValue as Severity;
        data.customSeverityId = o.customOptionId;
      } else {
        const o = await resolveCaseOption(
          projectId,
          'TestType',
          keyByName(typ, proposed.type),
          'Functional',
        );
        if (!o) return bad('That type is not valid for this workspace.', 422);
        before.type = row.type;
        before.customTypeId = row.customTypeId;
        data.type = o.enumValue as TestType;
        data.customTypeId = o.customOptionId;
      }
    }

    // Guarded write: only succeeds if nobody edited the case in the meantime.
    const res = await prisma.testCase.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: data as Prisma.TestCaseUncheckedUpdateManyInput,
    });
    if (res.count === 0)
      return bad(
        'This test case was changed after the suggestion was made. Close this and run Improve with AI again.',
        409,
      );

    return ok({
      applied: fields,
      undo: { updated: [{ id: row.id, before }] },
    });
  } catch (e) {
    if (e instanceof RevisionError) return bad(e.message, 422);
    return serverError(e);
  }
}
