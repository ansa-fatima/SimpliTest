import { prisma } from '@/lib/db';
import { Prisma, Priority, Severity, TestType } from '@prisma/client';
import { ok, bad, parseJson, serverError } from '@/lib/api';

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
const SEVERITIES: Severity[] = ['Critical', 'Major', 'Minor'];
const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];

interface ImportRow {
  module?: string;
  feature?: string;
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
  defaultModule?: string; // used when row.module is missing
  defaultFeature?: string; // used when row.feature is missing
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
// Body: { rows: [...], defaultModule?, defaultFeature? }
// Auto-creates modules/features that don't exist.
// Returns { created: number, skipped: { row: number, reason: string }[] }
export async function POST(req: Request) {
  try {
    const body = await parseJson<ImportBody>(req);
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
      return bad('rows array is required');
    }
    if (body.rows.length > 5000) return bad('max 5000 rows per import');

    // Cache modules + features so we don't re-hit DB for every row
    const moduleByName = new Map<string, string>(); // name → id
    const featureByKey = new Map<string, string>(); // `${moduleId}:${featureName}` → featureId

    const existingModules = await prisma.module.findMany({
      include: { features: true },
    });
    for (const m of existingModules) {
      moduleByName.set(m.name.toLowerCase(), m.id);
      for (const f of m.features) {
        featureByKey.set(`${m.id}:${f.name.toLowerCase()}`, f.id);
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
      const featureName = (r.feature || body.defaultFeature || '').trim();
      if (!moduleName) {
        skipped.push({ row: rowNum, reason: 'missing module' });
        continue;
      }
      if (!featureName) {
        skipped.push({ row: rowNum, reason: 'missing feature' });
        continue;
      }

      // Resolve / auto-create module
      let moduleId = moduleByName.get(moduleName.toLowerCase());
      if (!moduleId) {
        const newMod = await prisma.module.create({ data: { name: moduleName } });
        moduleId = newMod.id;
        moduleByName.set(moduleName.toLowerCase(), moduleId);
      }

      // Resolve / auto-create feature
      const featKey = `${moduleId}:${featureName.toLowerCase()}`;
      let featureId = featureByKey.get(featKey);
      if (!featureId) {
        const newFeat = await prisma.feature.create({ data: { name: featureName, moduleId } });
        featureId = newFeat.id;
        featureByKey.set(featKey, featureId);
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
        featureId,
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
