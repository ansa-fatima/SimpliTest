import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { AiError, reviseCase } from '@/lib/ai';
import { resolveAiConfig } from '@/lib/aiConfig';
import { resolveParent } from '@/lib/aiGenerate';
import { caseWriteDenied } from '@/lib/caseAccess';
import { normalizeRevision, RevisionError, type CaseSnapshot } from '@/lib/caseRevision';
import { listWorkspaceOptions } from '@/lib/options';

export const dynamic = 'force-dynamic';

interface Body {
  caseId?: string;
  instruction?: string;
}

// POST /api/test-cases/ai-update
// "Improve with AI" for ONE existing case: applies the user's instruction and
// returns the current and suggested versions plus exactly which fields differ.
// Nothing is saved here -- the user picks fields to keep (see ./apply).
export async function POST(req: Request) {
  try {
    const userOrRes = await requireUser();
    if (userOrRes instanceof NextResponse) return userOrRes;
    const user = userOrRes;

    const body = await parseJson<Body>(req);
    if (!body) return bad('Invalid request body');
    const instruction = body.instruction?.trim() ?? '';
    if (instruction.length < 5) return bad('Tell the AI what to change (a few words at least).');
    if (instruction.length > 2000)
      return bad('The instruction is too long (2,000 characters max).');
    if (!body.caseId) return bad('Missing test case.');

    const row = await prisma.testCase.findUnique({
      where: { id: body.caseId },
      include: { customPriority: true, customSeverity: true, customType: true },
    });
    if (!row) return bad('That test case no longer exists.', 404);

    const parentType = row.suiteId ? 'suite' : row.moduleId ? 'module' : 'portal';
    const parentId = row.suiteId ?? row.moduleId ?? row.portalId;
    const parent = parentId ? await resolveParent(parentType, parentId) : null;
    if (!parent) return bad('That test case has no location.', 404);

    const denied = await caseWriteDenied(user, parent.projectId);
    if (denied) return bad(denied.message, denied.status);

    const cfg = await resolveAiConfig(parent.projectId);
    if (!cfg)
      return bad(
        'AI is not set up for this workspace yet. An admin can add an API key under Settings > Integrations.',
        503,
      );

    const [priority, severity, type] = await Promise.all([
      listWorkspaceOptions(parent.projectId, 'Priority'),
      listWorkspaceOptions(parent.projectId, 'Severity'),
      listWorkspaceOptions(parent.projectId, 'TestType'),
    ]);
    const options = {
      priority: priority.map(o => o.name),
      severity: severity.map(o => o.name),
      type: type.map(o => o.name),
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

    const raw = await reviseCase({ instruction, parentPath: parent.path, current, options }, cfg);
    const revision = normalizeRevision(raw, current, options);

    return ok({
      caseId: row.id,
      current,
      proposed: revision.proposed,
      changedFields: revision.changedFields,
      summary: revision.summary,
      unchanged: revision.changedFields.length === 0,
      // The version this suggestion was made from; apply refuses if it moved on.
      baseUpdatedAt: row.updatedAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof AiError) return bad(e.message, e.status);
    if (e instanceof RevisionError) return bad(e.message, 422);
    return serverError(e);
  }
}
