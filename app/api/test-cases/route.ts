import { prisma } from '@/lib/db';
import { Prisma, Priority, Severity, TestType, CaseStatus, OptionCategory } from '@prisma/client';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';
import { projectIdForCaseParent, resolveCaseOption } from '@/lib/testCaseOptions';
import { isBuiltinOptionValue } from '@/lib/options';

const STATUSES: CaseStatus[] = ['Active', 'Draft', 'Archived'];

// Builds a Prisma OR clause matching a case's EFFECTIVE priority/severity/
// type against a set of category keys (see lib/options.ts -- each key is
// either a built-in enum literal or a custom WorkspaceOption.id). A legacy,
// never-overridden case matches a built-in key via the enum column; a case
// with a custom override matches only via the override id.
function caseOptionWhereClause(
  category: OptionCategory,
  keys: string[],
  enumField: 'priority' | 'severity' | 'type',
  customField: 'customPriorityId' | 'customSeverityId' | 'customTypeId',
): Prisma.TestCaseWhereInput | null {
  if (keys.length === 0) return null;
  const builtins = keys.filter(k => isBuiltinOptionValue(category, k));
  const customs = keys.filter(k => !isBuiltinOptionValue(category, k));
  const or: Prisma.TestCaseWhereInput[] = [];
  if (builtins.length) or.push({ [customField]: null, [enumField]: { in: builtins } });
  if (customs.length) or.push({ [customField]: { in: customs } });
  return { OR: or };
}

// Attachments ride inline as base64 data URLs in a JSON column (same trick
// as User.avatarUrl) -- no object storage. Capped modestly since this isn't
// meant for anything but a handful of small screenshots/specs per case.
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function cleanAttachments(
  input: { name: string; dataUrl: string; size: number }[] | undefined,
): { name: string; dataUrl: string; size: number }[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      a =>
        a &&
        typeof a.name === 'string' &&
        typeof a.dataUrl === 'string' &&
        a.dataUrl.startsWith('data:') &&
        typeof a.size === 'number' &&
        a.size <= MAX_ATTACHMENT_BYTES,
    )
    .slice(0, MAX_ATTACHMENTS)
    .map(a => ({ name: a.name.slice(0, 200), dataUrl: a.dataUrl, size: a.size }));
}

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
  // Only set when priority/severity/type is a custom option -- null
  // otherwise, meaning "use the built-in badge for the enum column value"
  // (see lib/utils.ts's priorityBadge/severityBadge/typeBadge).
  customPriority: { select: { name: true, color: true } },
  customSeverity: { select: { name: true, color: true } },
  customType: { select: { name: true, color: true } },
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

    // Each value is a category KEY (see lib/options.ts) -- a built-in enum
    // literal or a custom WorkspaceOption.id -- not narrowed to the enum
    // type, since a custom selection isn't one of those literals.
    const priorities = sp.getAll('priority');
    const severities = sp.getAll('severity');
    const types = sp.getAll('type');
    const statuses = sp
      .getAll('status')
      .filter((s): s is CaseStatus => STATUSES.includes(s as CaseStatus));
    const ownerIds = sp.getAll('ownerId').filter(Boolean);
    const portalId = sp.get('portalId') || undefined;

    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(5000, Math.max(1, parseInt(sp.get('pageSize') || '50', 10) || 50));

    const sortField = ['caseNum', 'title', 'createdAt', 'updatedAt', 'order'].includes(
      sp.get('sort') || '',
    )
      ? (sp.get('sort') as 'caseNum' | 'title' | 'createdAt' | 'updatedAt' | 'order')
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
    const priorityClause = caseOptionWhereClause(
      'Priority',
      priorities,
      'priority',
      'customPriorityId',
    );
    if (priorityClause) ands.push(priorityClause);
    const severityClause = caseOptionWhereClause(
      'Severity',
      severities,
      'severity',
      'customSeverityId',
    );
    if (severityClause) ands.push(severityClause);
    const typeClause = caseOptionWhereClause('TestType', types, 'type', 'customTypeId');
    if (typeClause) ands.push(typeClause);

    const where: Prisma.TestCaseWhereInput = ands.length ? { AND: ands } : {};
    if (statuses.length) where.status = { in: statuses as CaseStatus[] };
    if (ownerIds.length) where.ownerId = { in: ownerIds };

    const [rows, total] = await Promise.all([
      prisma.testCase.findMany({
        where,
        include: {
          ...caseInclude,
          // Last Result column -- most recently touched run stands in for
          // "latest", same fallback pointFromRun/pointFromQuickLog use
          // (executedAt is null until a verdict is actually recorded).
          runs: { orderBy: { updatedAt: 'desc' }, take: 1, select: { result: true } },
        },
        orderBy: { [sortField]: order },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.testCase.count({ where }),
    ]);
    const items = rows.map(({ runs, ...rest }) => ({
      ...rest,
      lastResult: runs[0]?.result ?? null,
    }));

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
      /** A category KEY (see lib/options.ts) -- a built-in enum literal or a custom WorkspaceOption.id. */
      priority?: string;
      severity?: string;
      type?: string;
      portalId?: string;
      moduleId?: string;
      suiteId?: string;
      featureId?: string; // legacy alias
      author?: string;
      status?: CaseStatus;
      ownerId?: string | null;
      preconditions?: string;
      labels?: string[];
      attachments?: { name: string; dataUrl: string; size: number }[];
    }>(req);
    if (!body) return bad('Invalid request body');

    const title = body?.title?.trim();
    const suiteId = body?.suiteId ?? body?.featureId ?? null;
    const moduleId = body?.moduleId ?? null;
    const portalId = body?.portalId ?? null;

    // Exactly one parent must be set — Portal OR Module OR Suite.
    const parentCount = [portalId, moduleId, suiteId].filter(Boolean).length;
    if (!title) return bad('title is required');
    if (parentCount === 0) return bad('portalId, moduleId, or suiteId is required');
    if (parentCount > 1) return bad('only one of portalId / moduleId / suiteId may be set');

    const projectId = await projectIdForCaseParent({ portalId, moduleId, suiteId });
    if (!projectId) return bad('Parent not found');

    const priorityOpt = await resolveCaseOption(projectId, 'Priority', body?.priority, 'Medium');
    if (!priorityOpt)
      return bad('priority is required and must be a valid option for this workspace');
    const severityOpt = await resolveCaseOption(projectId, 'Severity', body?.severity, 'Minor');
    if (!severityOpt)
      return bad('severity is required and must be a valid option for this workspace');
    const typeOpt = await resolveCaseOption(projectId, 'TestType', body?.type, 'Functional');
    if (!typeOpt) return bad('type is required and must be a valid option for this workspace');

    const status: CaseStatus =
      body?.status && STATUSES.includes(body.status) ? body.status : 'Active';

    // New cases land at the end of their sibling list, not the front.
    const last = await prisma.testCase.findFirst({
      where: { portalId, moduleId, suiteId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const tc = await prisma.testCase.create({
      data: {
        title,
        sub: body.sub ?? body.desc?.split('.')[0] ?? title,
        desc: body.desc ?? '',
        preconditions: body.preconditions ?? '',
        steps: (body.steps ?? []) as Prisma.InputJsonValue,
        expected: body.expected ?? '',
        priority: priorityOpt.enumValue as Priority,
        customPriorityId: priorityOpt.customOptionId,
        severity: severityOpt.enumValue as Severity,
        customSeverityId: severityOpt.customOptionId,
        type: typeOpt.enumValue as TestType,
        customTypeId: typeOpt.customOptionId,
        status,
        portalId,
        moduleId,
        suiteId,
        author: body.author ?? '',
        ownerId: body.ownerId ?? null,
        order: (last?.order ?? -1) + 1,
        labels: (body.labels ?? []).map(l => l.trim()).filter(Boolean),
        attachments: cleanAttachments(body.attachments) as unknown as Prisma.InputJsonValue,
      },
      include: caseInclude,
    });
    return ok(tc, 201);
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
