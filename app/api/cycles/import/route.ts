import { prisma } from '@/lib/db';
import { CycleScopeType, Prisma } from '@prisma/client';
import { ok, bad, parseJson, prismaError, serverError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { CycleImportRow, mapSheetRow, validateRow, normalizeOutcome } from '@/lib/cycleOutcome';
import { deriveSiteUrlFromTicketLink } from '@/lib/jira';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 5_000;

interface ImportBody {
  projectId?: string;
  // Rows already mapped to canonical keys by the client (mapSheetRow), OR raw
  // header-keyed objects straight from the sheet -- both are accepted and
  // re-normalized here so the server never trusts the client's mapping.
  rows?: Record<string, unknown>[];
}

// POST /api/cycles/import
//   Body: { projectId, rows: [...] }
// Bulk-creates Manual (quick-log / testing-cycle) entries from an uploaded
// Excel/CSV sheet. Each row's Module/Feature is resolved BY NAME against the
// workspace's existing Portal > Module > Suite tree so the cycle links to a
// real scope and feeds the Stability report; unmatched names are kept as free
// text with scopeType 'All' (never auto-creating tree nodes from an import --
// that stays a deliberate admin action). Returns a per-row summary so the UI
// can show what was created vs skipped and why.
export async function POST(req: Request) {
  const userOrRes = await requireUser();
  if (userOrRes instanceof NextResponse) return userOrRes;

  try {
    const body = await parseJson<ImportBody>(req);
    if (!body?.projectId) return bad('projectId is required');
    if (!Array.isArray(body.rows) || body.rows.length === 0) return bad('rows is required');
    if (body.rows.length > MAX_ROWS) return bad(`Too many rows (max ${MAX_ROWS})`);

    const membership = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: userOrRes.id, projectId: body.projectId } },
    });
    if (!membership) return bad('Not a member of this workspace', 403);

    // Resolve the tree once, keyed by lowercased name for case-insensitive
    // matching. A module name can repeat across portals, so module lookup is
    // optionally narrowed by a given portal name.
    const [modules, suites] = await Promise.all([
      prisma.module.findMany({
        where: { portal: { projectId: body.projectId } },
        select: { id: true, name: true, portal: { select: { id: true, name: true } } },
      }),
      prisma.suite.findMany({
        where: { module: { portal: { projectId: body.projectId } }, parentId: null },
        select: { id: true, name: true, moduleId: true },
      }),
    ]);
    const suitesByModule = new Map<string, { id: string; name: string }[]>();
    for (const s of suites) {
      const arr = suitesByModule.get(s.moduleId) ?? [];
      arr.push({ id: s.id, name: s.name });
      suitesByModule.set(s.moduleId, arr);
    }
    const lc = (s: string) => s.trim().toLowerCase();

    const resolveScope = (
      row: CycleImportRow,
    ): { scopeType: CycleScopeType; scopeId: string | null } => {
      if (!row.module) return { scopeType: 'All', scopeId: null };
      const candidates = modules.filter(m => lc(m.name) === lc(row.module));
      const mod = row.portal
        ? (candidates.find(m => lc(m.portal.name) === lc(row.portal)) ?? candidates[0])
        : candidates[0];
      if (!mod) return { scopeType: 'All', scopeId: null };
      if (row.feature) {
        const suite = (suitesByModule.get(mod.id) ?? []).find(s => lc(s.name) === lc(row.feature));
        if (suite) return { scopeType: 'Suite', scopeId: suite.id };
      }
      return { scopeType: 'Module', scopeId: mod.id };
    };

    const errors: { row: number; reason: string }[] = [];
    const toCreate: Prisma.TestCycleUncheckedCreateInput[] = [];

    body.rows.forEach((raw, i) => {
      // Re-map on the server even if the client already did -- never trust the
      // shape a client sends.
      const row = mapSheetRow(raw);
      const v = validateRow(row);
      if (!v.ok) {
        errors.push({ row: i + 2, reason: v.errors.join('; ') }); // +2: 1-based + header row
        return;
      }
      const { scopeType, scopeId } = resolveScope(row);
      const issueCount = row.critical + row.major + row.minor;
      const remaining = Math.min(row.openIssues, issueCount);
      const done = Math.max(0, issueCount - remaining);
      const date = new Date(`${row.date}T00:00:00`);
      const name =
        row.name ||
        [row.module, row.feature].filter(Boolean).join(' → ') ||
        row.module ||
        `Testing cycle — ${row.date}`;

      toCreate.push({
        name,
        description: row.notes,
        projectId: body.projectId!,
        mode: 'Manual',
        status: 'Completed',
        scopeType,
        scopeId,
        completedAt: date,
        createdAt: date,
        portalName: row.portal || null,
        moduleName: row.module || null,
        featureName: row.feature || null,
        environment: row.environment || null,
        platform: row.platform || null,
        version: row.version || null,
        cycleCategory: row.cycleType || null,
        ticketLink: row.ticket || null,
        testRunLink: row.testRunLink || null,
        outcome: normalizeOutcome(row.outcome),
        loggedBy: row.qaEngineer || '',
        jiraSiteUrl: row.ticket ? deriveSiteUrlFromTicketLink(row.ticket) : null,
        issueCount,
        criticalCount: row.critical,
        majorCount: row.major,
        minorCount: row.minor,
        doneCount: done,
        remainingCount: remaining,
      });
    });

    let created = 0;
    // One row at a time (not createMany) so a single bad row can't fail the
    // whole batch -- it's reported and the rest still import.
    for (let i = 0; i < toCreate.length; i++) {
      try {
        await prisma.testCycle.create({ data: toCreate[i] });
        created++;
      } catch (e) {
        errors.push({ row: i + 2, reason: (e as Error).message });
      }
    }

    return ok({
      created,
      totalRows: body.rows.length,
      skipped: errors.length,
      errors,
    });
  } catch (e) {
    return prismaError(e) ?? serverError(e);
  }
}
