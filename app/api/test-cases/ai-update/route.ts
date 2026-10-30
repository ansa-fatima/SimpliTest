import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { AiError, reviseCase } from '@/lib/ai';
import { resolveAiConfig } from '@/lib/aiConfig';
import { parseAttachments, resolveParent } from '@/lib/aiGenerate';
import { MAX_REFERENCE_CHARS, MAX_REFERENCE_PROMPT_CHARS } from '@/lib/aiLimits';
import { pickExcerpts } from '@/lib/referenceExcerpt';
import { caseWriteDenied } from '@/lib/caseAccess';
import { normalizeRevision, RevisionError, type CaseSnapshot } from '@/lib/caseRevision';
import { listWorkspaceOptions } from '@/lib/options';

export const dynamic = 'force-dynamic';

interface Body {
  caseId?: string;
  instruction?: string;
  /** Optional reference document (requirement / spec) as text, and/or PDFs / images. */
  reference?: string;
  attachments?: { name?: string; mediaType?: string; data?: string }[];
}

// A long document is cut down to the passages that matter for THIS case.
function referenceFor(reference: string, path: string, c: CaseSnapshot): string {
  const query = [path, c.title, c.desc, c.preconditions, ...c.steps, c.expected].join(' ');
  const { text, trimmed } = pickExcerpts(reference, query, MAX_REFERENCE_PROMPT_CHARS);
  if (!trimmed) return text;
  const note =
    '[Excerpts of a longer document, chosen for this test case. Parts not shown may cover other features -- do not assume they are missing.]';
  return `${note}\n\n${text}`;
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
    const reference = body.reference?.trim() ?? '';
    if (reference.length > MAX_REFERENCE_CHARS)
      return bad(
        `The reference document is too long (${MAX_REFERENCE_CHARS.toLocaleString('en-US')} characters max).`,
      );
    const parsed = parseAttachments(body.attachments);
    if ('error' in parsed) return bad(parsed.error);
    const attachments = parsed.attachments;
    const hasReference = reference.length > 0 || attachments.length > 0;
    // With a reference document the instruction is optional: the document is the brief.
    const instruction =
      body.instruction?.trim() ||
      (hasReference ? 'Align this test case with the reference document.' : '');
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

    const raw = await reviseCase(
      {
        instruction,
        parentPath: parent.path,
        current,
        options,
        ...(reference ? { reference: referenceFor(reference, parent.path, current) } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      cfg,
    );
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
