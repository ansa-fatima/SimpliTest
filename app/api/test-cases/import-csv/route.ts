import { prisma } from '@/lib/db';
import { Prisma, Priority, Severity, TestType } from '@prisma/client';
import { ok, bad, parseJson, serverError } from '@/lib/api';
import { parseCSV } from '@/lib/csv';

// POST /api/test-cases/import-csv
//   Body: { projectId: string, csv: string }
//
// Parses a TestRail-style CSV and creates the full hierarchy:
//   • "Section Hierarchy" column drives Portal > Module > Suite paths
//   • Auto-creates any missing portal / module / suite under the given project
//   • Imported test case IDs (e.g. "C2509") are discarded — caseNum is system-generated
//
// Returns a summary of what was created vs skipped, so the UI can show a confirmation.

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
const SEVERITIES: Severity[] = ['Critical', 'Major', 'Minor'];
const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];

const MAX_ROWS = 10_000;
const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB

interface ImportBody {
  projectId?: string;
  csv?: string;
  /** Skip header-row prefix when matching hierarchy. e.g. if "SimpliEd System" matches
   *  the project name, drop it from the path before mapping to Portal/Module/Suite. */
  stripProjectPrefix?: boolean;
  /** Fallback target for rows whose CSV has no "Section Hierarchy" column. Each row will
   *  land in <portalName> > <moduleName> > <suiteName>. Required when the CSV has no
   *  hierarchy column. Ignored on a per-row basis when the row has its own hierarchy. */
  fallback?: {
    portalName?: string;
    moduleName?: string;
    suiteName?: string;
  };
}

export async function POST(req: Request) {
  try {
    const body = await parseJson<ImportBody>(req);
    if (!body?.projectId) return bad('projectId is required');
    if (!body?.csv || typeof body.csv !== 'string')
      return bad('csv field (raw CSV text) is required');
    if (body.csv.length > MAX_CSV_BYTES)
      return bad(`CSV exceeds ${MAX_CSV_BYTES / 1024 / 1024} MB limit`);

    const stripProjectPrefix = body.stripProjectPrefix !== false;

    // Sanity-check target project + grab its name for prefix stripping.
    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: { id: true, name: true },
    });
    if (!project) return bad('Target project not found', 404);

    const rows = parseCSV(body.csv);
    if (rows.length < 2) return bad('CSV looks empty (no data rows)');
    if (rows.length - 1 > MAX_ROWS) return bad(`CSV exceeds ${MAX_ROWS} rows`);

    const header = rows[0];
    const col = Object.fromEntries(header.map((h, i) => [h.trim(), i] as const));
    if (col['Title'] === undefined) {
      return bad('CSV is missing required column "Title"');
    }
    const hasHierarchy = col['Section Hierarchy'] !== undefined;
    const hasSection = col['Section'] !== undefined;

    // If no hierarchy column at all, we need a fallback target to land the rows in.
    const fb = body.fallback ?? {};
    const fbPortal = fb.portalName?.trim() || '';
    const fbModule = fb.moduleName?.trim() || '';
    const fbSuite = fb.suiteName?.trim() || '';

    if (!hasHierarchy && !hasSection) {
      if (!fbPortal || !fbModule || !fbSuite) {
        return bad(
          'CSV has no "Section Hierarchy" or "Section" column. Provide a fallback target (portal + module + suite) to import these rows.',
        );
      }
    }

    // Pre-load every portal/module/suite already under the project so we can dedupe in memory.
    const existingPortals = await prisma.portal.findMany({
      where: { projectId: project.id },
      include: {
        modules: { include: { suites: { select: { id: true, name: true } } } },
      },
    });
    const portalIdByName = new Map<string, string>();
    const moduleIdByKey = new Map<string, string>(); // `${portalId}|${moduleName}`
    const suiteIdByKey = new Map<string, string>(); // `${moduleId}|${suiteName}`
    for (const p of existingPortals) {
      portalIdByName.set(p.name.toLowerCase(), p.id);
      for (const m of p.modules) {
        moduleIdByKey.set(`${p.id}|${m.name.toLowerCase()}`, m.id);
        for (const s of m.suites) {
          suiteIdByKey.set(`${m.id}|${s.name.toLowerCase()}`, s.id);
        }
      }
    }

    let createdPortals = 0;
    let createdModules = 0;
    let createdSuites = 0;
    let createdCases = 0;
    const skipped: { row: number; reason: string }[] = [];

    // Row processing — sequential because each row may need to read/create the hierarchy
    // for the next row. Performance-wise this is still fast for a few thousand rows.
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 1;

      const title = (r[col['Title']] || '').trim();
      if (!title) {
        skipped.push({ row: rowNum, reason: 'empty title' });
        continue;
      }

      // ── Resolve hierarchy: prefer per-row "Section Hierarchy", then "Section",
      //    then fall back to the modal-provided portal/module/suite. ────────
      const hierRaw = hasHierarchy ? (r[col['Section Hierarchy']] || '').trim() : '';
      const sectionRaw = hasSection ? (r[col['Section']] || '').trim() : '';

      let portalName: string;
      let moduleName: string;
      let suiteName: string;

      if (hierRaw) {
        let parts = hierRaw
          .split('>')
          .map(s => s.trim())
          .filter(Boolean);
        if (stripProjectPrefix && parts.length > 0) {
          if (parts[0].toLowerCase() === project.name.toLowerCase()) {
            parts = parts.slice(1);
          }
        }
        if (parts.length >= 3) {
          suiteName = parts[parts.length - 1];
          moduleName = parts[parts.length - 2];
          portalName = parts.slice(0, parts.length - 2).join(' / ') || fbPortal || 'Default portal';
        } else if (parts.length === 2) {
          portalName = fbPortal || parts[0];
          moduleName = parts[1];
          suiteName = (r[col['Suite']] || fbSuite || 'General').trim() || 'General';
        } else if (parts.length === 1) {
          portalName = fbPortal || 'Default portal';
          moduleName = fbModule || parts[0];
          suiteName = (r[col['Suite']] || fbSuite || 'General').trim() || 'General';
        } else {
          // Empty hierarchy on this row — try the fallback.
          if (fbPortal && fbModule && fbSuite) {
            portalName = fbPortal;
            moduleName = fbModule;
            suiteName = fbSuite;
          } else {
            skipped.push({ row: rowNum, reason: 'empty Section Hierarchy' });
            continue;
          }
        }
      } else if (sectionRaw) {
        // CSV had a "Section" column (single folder name) — pair with the fallback portal/module.
        if (!fbPortal || !fbModule) {
          skipped.push({
            row: rowNum,
            reason: 'CSV has Section but no portal/module fallback was provided',
          });
          continue;
        }
        portalName = fbPortal;
        moduleName = fbModule;
        suiteName = sectionRaw;
      } else {
        // Pure fallback — every row goes to the same target.
        portalName = fbPortal;
        moduleName = fbModule;
        suiteName = fbSuite;
      }

      // ── Get-or-create portal ──
      let portalId = portalIdByName.get(portalName.toLowerCase());
      if (!portalId) {
        const created = await prisma.portal.create({
          data: {
            name: portalName,
            slug: slugify(portalName),
            icon: guessPortalIcon(portalName),
            projectId: project.id,
          },
        });
        portalId = created.id;
        portalIdByName.set(portalName.toLowerCase(), portalId);
        createdPortals++;
      }

      // ── Get-or-create module ──
      const modKey = `${portalId}|${moduleName.toLowerCase()}`;
      let moduleId = moduleIdByKey.get(modKey);
      if (!moduleId) {
        const created = await prisma.module.create({
          data: { name: moduleName, portalId },
        });
        moduleId = created.id;
        moduleIdByKey.set(modKey, moduleId);
        createdModules++;
      }

      // ── Get-or-create suite ──
      const suiteKey = `${moduleId}|${suiteName.toLowerCase()}`;
      let suiteId = suiteIdByKey.get(suiteKey);
      if (!suiteId) {
        const created = await prisma.suite.create({
          data: { name: suiteName, moduleId },
        });
        suiteId = created.id;
        suiteIdByKey.set(suiteKey, suiteId);
        createdSuites++;
      }

      // ── Skip duplicate test cases (matched by title within the suite) ──
      const existing = await prisma.testCase.findFirst({
        where: { suiteId, title },
        select: { id: true },
      });
      if (existing) {
        skipped.push({ row: rowNum, reason: 'duplicate title in target suite' });
        continue;
      }

      // ── Build test case fields ──
      const priority = mapPriority(r[col['Priority']]);
      const severity = mapSeverity(r[col['Severity']]);
      const type = mapType(r[col['Test Type']]);
      const desc = (r[col['Description']] || '').trim();
      const expected = (r[col['Expected Result']] || '').trim();
      const stepsRaw =
        (col['Steps'] !== undefined ? r[col['Steps']] : '') ||
        (col['Steps (Step)'] !== undefined ? r[col['Steps (Step)']] : '') ||
        '';
      const steps = parseSteps(stepsRaw);
      const preconditions = (r[col['Preconditions']] || '').trim();
      const author = (r[col['Created By']] || '').trim() || 'Imported';

      await prisma.testCase.create({
        data: {
          title,
          sub: desc.split('.')[0] || title.slice(0, 80),
          desc,
          preconditions,
          steps: steps as Prisma.InputJsonValue,
          expected,
          priority,
          severity,
          type,
          status: 'Active',
          author,
          suiteId,
        },
      });
      createdCases++;
    }

    return ok({
      createdPortals,
      createdModules,
      createdSuites,
      createdCases,
      skipped,
      totalRows: rows.length - 1,
    });
  } catch (e) {
    return serverError(e);
  }
}

// ─── helpers ────────────────────────────────────────────────

function mapPriority(p: string | undefined): Priority {
  const s = (p || '').trim().toLowerCase();
  if (['critical', 'high', 'urgent'].includes(s)) return 'High';
  if (['moderate', 'medium', 'normal'].includes(s)) return 'Medium';
  if (['low', 'minor'].includes(s)) return 'Low';
  return 'Medium';
}

function mapSeverity(s: string | undefined): Severity {
  const v = (s || '').trim().toLowerCase();
  if (['critical', 'blocker'].includes(v)) return 'Critical';
  if (['high', 'major'].includes(v)) return 'Major';
  return 'Minor';
}

function mapType(t: string | undefined): TestType {
  if (!t) return 'Functional';
  const candidates = t.split(/[,\n/]+/).map(x => x.trim());
  for (const c of candidates) {
    if (TYPES.includes(c as TestType)) return c as TestType;
  }
  return 'Functional';
}

function parseSteps(stepsRaw: string): string[] {
  if (!stepsRaw) return [];
  return stepsRaw
    .split(/\n+/)
    .map(s => s.replace(/^\s*\d+\.\s*/, '').trim())
    .filter(Boolean);
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'item'
  );
}

function guessPortalIcon(name: string): string | null {
  const l = name.toLowerCase();
  if (l.includes('mobile')) return 'ti-device-mobile';
  if (l.includes('admin')) return 'ti-shield-lock';
  if (l.includes('teacher')) return 'ti-school';
  if (l.includes('parent')) return 'ti-users';
  if (l.includes('student')) return 'ti-user';
  if (l.includes('web')) return 'ti-world';
  return null;
}
