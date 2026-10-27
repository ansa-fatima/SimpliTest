// Shared server-side steps of "Generate with AI", used by both the plain and the
// streaming route: validating the request, loading the workspace's options and
// settings, finding the existing cases to compare with, and turning a generated
// case into a proposal with a duplicate verdict.

import { prisma } from '@/lib/db';
import { caseWriteDenied } from '@/lib/caseAccess';
import { listWorkspaceOptions } from '@/lib/options';
import { compareCases, findNearDuplicate } from '@/lib/caseSimilarity';
import { normalizeAiSettings, type AiSettings } from '@/lib/aiSettings';
import { resolveAiConfig, type AiConfig } from '@/lib/aiConfig';
import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  judgeDuplicates,
  type AiAttachment,
  type Depth,
  type GeneratedCase,
  type OptionNames,
  type StepStyle,
} from '@/lib/ai';

export type ParentType = 'portal' | 'module' | 'suite';

export interface GenerateBody {
  parentType?: ParentType;
  parentId?: string;
  requirement?: string;
  count?: number;
  depth?: Depth;
  style?: StepStyle;
  /** Titles the user already kept, so a "generate more" doesn't repeat them. */
  keepTitles?: string[];
  /** PDFs / images that describe the requirement (base64). */
  attachments?: { name?: string; mediaType?: string; data?: string }[];
}

export interface ExistingCase {
  id: string;
  caseNum: number;
  title: string;
  desc: string;
  preconditions: string;
  steps: string[];
  expected: string;
  priority: string;
  severity: string;
  type: string;
}

export interface Proposal extends GeneratedCase {
  verdict: 'new' | 'duplicate';
  match: (ExistingCase & { similarity: number }) | null;
  /** Who decided: the wording check, or the AI double-check. */
  source: 'wording' | 'ai';
}

export interface Prepared {
  parentType: ParentType;
  parentId: string;
  projectId: string;
  parentPath: string;
  requirement: string;
  attachments: AiAttachment[];
  count: number;
  depth: Depth;
  style: StepStyle;
  options: OptionNames;
  keepTitles: string[];
  settings: AiSettings;
  existing: ExistingCase[];
  /** The workspace's AI key and models. */
  cfg: AiConfig;
}

export type PrepareResult =
  | { ok: true; p: Prepared }
  | { ok: false; message: string; status: number };

const fail = (message: string, status = 400): PrepareResult => ({ ok: false, message, status });

// Resolves the chosen parent into its workspace and a readable path.
export async function resolveParent(type: ParentType, id: string) {
  if (type === 'portal') {
    const p = await prisma.portal.findUnique({
      where: { id },
      select: { name: true, projectId: true },
    });
    return p ? { projectId: p.projectId, path: p.name } : null;
  }
  if (type === 'module') {
    const m = await prisma.module.findUnique({
      where: { id },
      select: { name: true, portal: { select: { name: true, projectId: true } } },
    });
    return m ? { projectId: m.portal.projectId, path: `${m.portal.name} › ${m.name}` } : null;
  }
  const s = await prisma.suite.findUnique({
    where: { id },
    select: {
      name: true,
      module: { select: { name: true, portal: { select: { name: true, projectId: true } } } },
    },
  });
  return s
    ? {
        projectId: s.module.portal.projectId,
        path: `${s.module.portal.name} › ${s.module.name} › ${s.name}`,
      }
    : null;
}

// Every case already saved under the chosen location (the node itself plus
// anything nested below it) -- what a generated case is compared against.
async function existingCasesUnder(type: ParentType, id: string): Promise<ExistingCase[]> {
  const where =
    type === 'suite'
      ? { suiteId: id }
      : type === 'module'
        ? { OR: [{ moduleId: id }, { suite: { moduleId: id } }] }
        : {
            OR: [
              { portalId: id },
              { module: { portalId: id } },
              { suite: { module: { portalId: id } } },
            ],
          };
  const rows = await prisma.testCase.findMany({
    where,
    take: 1000,
    orderBy: { caseNum: 'asc' },
    select: {
      id: true,
      caseNum: true,
      title: true,
      desc: true,
      preconditions: true,
      steps: true,
      expected: true,
      priority: true,
      severity: true,
      type: true,
      customPriority: { select: { name: true } },
      customSeverity: { select: { name: true } },
      customType: { select: { name: true } },
    },
  });
  return rows.map(r => ({
    id: r.id,
    caseNum: r.caseNum,
    title: r.title,
    desc: r.desc,
    preconditions: r.preconditions,
    steps: (Array.isArray(r.steps) ? r.steps : []).filter(
      (s): s is string => typeof s === 'string',
    ),
    expected: r.expected,
    priority: r.customPriority?.name ?? r.priority,
    severity: r.customSeverity?.name ?? r.severity,
    type: r.customType?.name ?? r.type,
  }));
}

/** Validates the request and gathers everything generation needs. */
export async function prepareGeneration(
  body: GenerateBody,
  user: { id: string; role: string },
): Promise<PrepareResult> {
  const requirement = body.requirement?.trim() ?? '';

  // Attached files (PDF / screenshots) -- validated before anything is sent on.
  const attachments: AiAttachment[] = [];
  for (const a of Array.isArray(body.attachments) ? body.attachments : []) {
    if (
      !a ||
      typeof a.data !== 'string' ||
      !(ATTACHMENT_TYPES as readonly string[]).includes(a.mediaType ?? '')
    )
      return fail('Only PDF and PNG / JPG / WEBP / GIF files can be attached.');
    // Size first (cheap), then the characters -- a negated-class search, since a
    // greedy regex over a multi-megabyte string overflows the stack.
    if (Math.floor((a.data.length * 3) / 4) > MAX_ATTACHMENT_BYTES)
      return fail(`${a.name ?? 'A file'} is too large (5 MB max per file).`);
    const pad = a.data.indexOf('=');
    if (
      a.data.length === 0 ||
      /[^A-Za-z0-9+/=]/.test(a.data) ||
      (pad !== -1 && pad < a.data.length - 2)
    )
      return fail('An attached file could not be read.');
    attachments.push({
      name: (a.name ?? 'file').slice(0, 80),
      mediaType: a.mediaType as string,
      data: a.data,
    });
  }
  if (attachments.length > MAX_ATTACHMENTS) return fail(`Attach at most ${MAX_ATTACHMENTS} files.`);

  if (requirement.length < 15 && attachments.length === 0)
    return fail('Describe the requirement in a bit more detail.');
  if (requirement.length > 8000) return fail('The requirement is too long (8,000 characters max).');
  if (
    !body.parentType ||
    !['portal', 'module', 'suite'].includes(body.parentType) ||
    !body.parentId
  )
    return fail('Pick a portal, module or suite for the new cases.');

  const parent = await resolveParent(body.parentType, body.parentId);
  if (!parent) return fail('That location no longer exists.', 404);

  const denied = await caseWriteDenied(user, parent.projectId);
  if (denied) return fail(denied.message, denied.status);

  const cfg = await resolveAiConfig(parent.projectId);
  if (!cfg)
    return fail(
      'AI generation is not set up for this workspace yet. An admin can add an API key under Settings > Integrations.',
      503,
    );

  const count = Math.min(25, Math.max(1, Math.floor(body.count ?? 8)));
  const depth: Depth =
    body.depth && ['happy', 'edge', 'negative'].includes(body.depth) ? body.depth : 'edge';
  const style: StepStyle = body.style === 'gwt' ? 'gwt' : 'actions';

  const [priority, severity, type, projectRow] = await Promise.all([
    listWorkspaceOptions(parent.projectId, 'Priority'),
    listWorkspaceOptions(parent.projectId, 'Severity'),
    listWorkspaceOptions(parent.projectId, 'TestType'),
    prisma.project.findUnique({ where: { id: parent.projectId }, select: { aiSettings: true } }),
  ]);
  const settings = normalizeAiSettings(projectRow?.aiSettings);
  const existing =
    settings.duplicateCheck === 'off'
      ? []
      : await existingCasesUnder(body.parentType, body.parentId);

  return {
    ok: true,
    p: {
      parentType: body.parentType,
      parentId: body.parentId,
      projectId: parent.projectId,
      parentPath: parent.path,
      requirement,
      attachments,
      count,
      depth,
      style,
      options: {
        priority: priority.map(o => o.name),
        severity: severity.map(o => o.name),
        type: type.map(o => o.name),
      },
      keepTitles: Array.isArray(body.keepTitles)
        ? body.keepTitles.filter(t => typeof t === 'string')
        : [],
      settings,
      existing,
      cfg,
    },
  };
}

/** A generated case plus the wording check's verdict against the existing cases. */
export function toProposal(
  gc: GeneratedCase,
  existing: ExistingCase[],
  settings: AiSettings,
): Proposal {
  const hit = findNearDuplicate(
    gc,
    existing,
    settings.duplicateCheck === 'titles' ? 'titles' : 'titlesSteps',
  );
  const match = hit ? existing.find(e => e.id === hit.id) : null;
  return {
    ...gc,
    verdict: hit ? 'duplicate' : 'new',
    match: hit && match ? { ...match, similarity: Math.round(hit.similarity * 100) / 100 } : null,
    source: 'wording',
  };
}

/**
 * Optional AI double-check: finds reworded duplicates the wording check misses
 * and rejects look-alikes that test something different. Updates `proposals` in
 * place. Any failure just means "no AI opinion" -- generation itself must never
 * fail because of it.
 */
export async function applyAiCheck(
  proposals: Proposal[],
  existing: ExistingCase[],
  settings: AiSettings,
  cfg: AiConfig,
): Promise<'off' | 'applied' | 'unavailable'> {
  if (!settings.aiTiebreak || settings.duplicateCheck === 'off' || existing.length === 0)
    return 'off';
  try {
    // Keep the request small: the 400 existing cases closest to anything proposed.
    const ranked = existing
      .map(e => ({
        e,
        score: Math.max(...proposals.map(p => compareCases(p, e).similarity)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 400)
      .map(x => x.e);
    const verdicts = await judgeDuplicates(
      {
        generated: proposals.map(p => ({ title: p.title, steps: p.steps })),
        existing: ranked.map(e => ({ caseNum: e.caseNum, title: e.title })),
      },
      cfg,
    );
    for (const v of verdicts) {
      const p = proposals[v.index];
      if (!p) continue;
      if (v.relation === 'different' || v.existingCaseNum === null) {
        p.verdict = 'new';
        p.match = null;
        p.source = 'ai';
        continue;
      }
      const target = existing.find(x => x.caseNum === v.existingCaseNum);
      if (!target) continue;
      p.verdict = 'duplicate';
      p.match = {
        ...target,
        similarity: Math.round(compareCases(p, target).similarity * 100) / 100,
      };
      p.source = 'ai';
    }
    return 'applied';
  } catch {
    return 'unavailable';
  }
}
