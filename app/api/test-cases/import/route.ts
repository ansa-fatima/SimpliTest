import { prisma } from '@/lib/db';
import { Prisma, Priority, Severity, TestType } from '@prisma/client';
import { ok, bad, parseJson, serverError } from '@/lib/api';

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
const SEVERITIES: Severity[] = ['Critical', 'Major', 'Minor'];
const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];

interface ImportRow {
  module?: string;
  suite?: string;
  feature?: string; // legacy alias for suite
  title?: string;
  desc?: string;
  steps?: unknown; // string | string[]
  expected?: string;
  priority?: string;
  severity?: string;
  type?: string;
  author?: string;
}

interface ImportBody {
  rows: ImportRow[];
  projectId: string; // required — every row needs to land in a project
  portalId?: string; // optional — defaults to the project's "Main" portal (created if needed)
  defaultModule?: string;
  defaultSuite?: string;
  defaultFeature?: string; // legacy alias for defaultSuite
}

// Normalize a freeform string against an allowed list (case-insensitive, returns canonical or null)
function normalize<T extends string>(input: string | undefined, allowed: T[]): T | null {
  if (!input) return null;
  const lower = input.trim().toLowerCase();
  return allowed.find(a => a.toLowerCase() === lower) ?? null;
}

// Parse steps from various sheet shapes:
//   - "1. step a\n2. step b"      → ["1. step a", "2. step b"]
//   - "step a; step b"            → ["step a", "step b"]
//   - "step a\nstep b"            → ["step a", "step b"]
//   - already an array            → kept as-is
function parseSteps(steps: unknown): unknown {
  if (Array.isArray(steps)) return steps.filter(s => typeof s === 'string' && s.trim());
  if (typeof steps === 'string') {
    const s = steps.trim();
    if (!s) return [];
    if (s.includes('\n'))
      return s
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean);
    if (s.includes(';'))
      return s
        .split(';')
        .map(x => x.trim())
        .filter(Boolean);
    return [s];
  }
  return [];
}

// POST /api/test-cases/import
// Body: { rows: [...], projectId, defaultModule?, defaultSuite? }
// Auto-creates modules/suites that don't exist inside the project.
// Returns { created: number, skipped: { row: number, reason: string }[] }
export async function POST(req: Request) {
  try {
    const body = await parseJson<ImportBody>(req);
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
      return bad('rows array is required');
    }
    if (!body.projectId) return bad('projectId is required');
    if (body.rows.length > 5000) return bad('max 5000 rows per import');

    // Resolve target portal: explicit portalId, else the project's "Main" portal (create if missing)
    let portalId = body.portalId;
    if (!portalId) {
      const main = await prisma.portal.findFirst({
        where: { projectId: body.projectId, name: 'Main' },
        select: { id: true },
      });
      if (main) {
        portalId = main.id;
      } else {
        const created = await prisma.portal.create({
          data: { name: 'Main', slug: 'main', projectId: body.projectId },
          select: { id: true },
        });
        portalId = created.id;
      }
    }

    // Cache modules + suites scoped to this portal so we don't re-hit DB per row
    const moduleByName = new Map<string, string>();
    const suiteByKey = new Map<string, string>(); // `${moduleId}:${suiteName}` → suiteId

    const existingModules = await prisma.module.findMany({
      where: { portalId },
      include: { suites: true },
    });
    for (const m of existingModules) {
      moduleByName.set(m.name.toLowerCase(), m.id);
      for (const s of m.suites) {
        suiteByKey.set(`${m.id}:${s.name.toLowerCase()}`, s.id);
      }
    }

    const skipped: { row: number; reason: string }[] = [];
    const toCreate: Prisma.TestCaseCreateManyInput[] = [];

    for (let i = 0; i < body.rows.length; i++) {
      const r = body.rows[i];
      const rowNum = i + 1;

      const title = (r.title ?? '').trim();
      if (!title) {
        skipped.push({ row: rowNum, reason: 'missing title' });
        continue;
      }

      const moduleName = (r.module || body.defaultModule || '').trim();
      const suiteName = (
        r.suite ||
        r.feature ||
        body.defaultSuite ||
        body.defaultFeature ||
        ''
      ).trim();
      if (!moduleName) {
        skipped.push({ row: rowNum, reason: 'missing module' });
        continue;
      }
      if (!suiteName) {
        skipped.push({ row: rowNum, reason: 'missing suite' });
        continue;
      }

      // Resolve / auto-create module within the portal
      let moduleId = moduleByName.get(moduleName.toLowerCase());
      if (!moduleId) {
        const newMod = await prisma.module.create({
          data: { name: moduleName, portalId },
        });
        moduleId = newMod.id;
        moduleByName.set(moduleName.toLowerCase(), moduleId);
      }

      // Resolve / auto-create suite
      const suiteKey = `${moduleId}:${suiteName.toLowerCase()}`;
      let suiteId = suiteByKey.get(suiteKey);
      if (!suiteId) {
        const newSuite = await prisma.suite.create({ data: { name: suiteName, moduleId } });
        suiteId = newSuite.id;
        suiteByKey.set(suiteKey, suiteId);
      }

      const priority = normalize(r.priority, PRIORITIES) ?? 'Medium';
      const severity = normalize(r.severity, SEVERITIES) ?? 'Major';
      const type = normalize(r.type, TYPES) ?? 'Functional';

      const steps = parseSteps(r.steps);

      toCreate.push({
        title,
        sub: (r.desc ?? '').split('.')[0] || title,
        desc: r.desc ?? '',
        steps: steps as Prisma.InputJsonValue,
        expected: r.expected ?? '',
        priority,
        severity,
        type,
        suiteId,
        author: r.author ?? 'Imported',
      });
    }

    let created = 0;
    if (toCreate.length > 0) {
      const result = await prisma.testCase.createMany({ data: toCreate });
      created = result.count;
    }

    return ok({ created, skipped, total: body.rows.length });
  } catch (e) {
    return serverError(e);
  }
}
