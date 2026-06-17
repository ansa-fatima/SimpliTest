/* eslint-disable */
/**
 * One-off importer: reads a TestRail-style CSV and inserts it into Simplitest.
 *
 * Usage:
 *   node prisma/scripts/import-simplied.js "C:/path/to/file.csv"
 *
 * Maps the CSV's "Section Hierarchy" (e.g. "SimpliEd System > SimpliEd - Mobile App > Parent Portal > Home")
 * to our 4-level model: Project > Portal > Module > Suite.
 *
 * Idempotent — re-running won't duplicate test cases (matched by title within a suite).
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_CSV = 'C:/Users/ansaf/Downloads/simplied_system (1).csv';
const csvPath = process.argv[2] || DEFAULT_CSV;

// ─── Minimal RFC-4180-ish CSV parser ───────────────────────
// Handles quoted fields containing commas, newlines, and escaped quotes ("").
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ',') {
        row.push(field);
        field = '';
        i++;
        continue;
      }
      if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }
      field += c;
      i++;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ─── Field mappers ─────────────────────────────────────────
function mapPriority(p) {
  const s = (p || '').trim().toLowerCase();
  if (['critical', 'high', 'urgent'].includes(s)) return 'High';
  if (['moderate', 'medium', 'normal'].includes(s)) return 'Medium';
  if (['low', 'minor'].includes(s)) return 'Low';
  return 'Medium';
}

function mapSeverity(s) {
  const v = (s || '').trim().toLowerCase();
  if (['critical', 'blocker'].includes(v)) return 'Critical';
  if (['high', 'major'].includes(v)) return 'Major';
  return 'Minor';
}

function mapType(t) {
  if (!t) return 'Functional';
  // Pick first recognised type (CSV may have "Functional\nRegression")
  const candidates = t.split(/[,\n/]+/).map(x => x.trim());
  const valid = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];
  for (const c of candidates) {
    if (valid.includes(c)) return c;
  }
  return 'Functional';
}

function parseSteps(stepsRaw) {
  if (!stepsRaw) return [];
  // Split on newlines, strip leading "1. " numbering, drop empty lines.
  return stepsRaw
    .split(/\n+/)
    .map(s => s.replace(/^\s*\d+\.\s*/, '').trim())
    .filter(Boolean);
}

function slugify(name) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'item'
  );
}

// ─── Main ──────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found at: ${csvPath}`);
    process.exit(1);
  }
  console.log(`Reading ${csvPath}…`);
  const text = fs.readFileSync(csvPath, 'utf-8').replace(/^﻿/, ''); // strip BOM
  const rows = parseCSV(text);
  if (rows.length < 2) {
    console.error('CSV looks empty.');
    process.exit(1);
  }

  const header = rows[0];
  // First-occurrence wins — TestRail exports have two "Steps" columns and the
  // second one is usually empty; without this fix it would shadow the real data.
  const col = {};
  header.forEach((h, i) => {
    if (col[h] === undefined) col[h] = i;
  });

  // Sanity-check expected columns
  for (const required of ['Title', 'Section Hierarchy']) {
    if (col[required] === undefined) {
      console.error(`CSV is missing required column "${required}"`);
      process.exit(1);
    }
  }

  // Body rows = everything after the header that has a title
  const dataRows = rows.slice(1).filter(r => (r[col['Title']] || '').trim());
  console.log(`Parsed ${dataRows.length} data rows.`);

  // Group by Section Hierarchy so multiple paths in one CSV work cleanly.
  const groups = new Map();
  for (const r of dataRows) {
    const hier = (r[col['Section Hierarchy']] || '').trim();
    if (!groups.has(hier)) groups.set(hier, []);
    groups.get(hier).push(r);
  }

  // Pick all existing users so we can add memberships to any new workspace.
  const allUsers = await prisma.user.findMany({
    select: { id: true, role: true },
  });

  let createdCases = 0;
  let skippedCases = 0;
  let createdProjects = 0;
  let createdPortals = 0;
  let createdModules = 0;
  let createdSuites = 0;

  for (const [hier, groupRows] of groups) {
    const parts = hier
      .split('>')
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length < 1) {
      console.warn(`Skipping rows with empty hierarchy (${groupRows.length} rows)`);
      skippedCases += groupRows.length;
      continue;
    }

    // Map the CSV hierarchy onto Project > Portal > Module > Suite.
    // The CSV usually has 4 parts ([System, Platform, Portal, Section]).
    // If it has fewer, fall back sensibly so we always have all 4 levels.
    const projectName = parts[0] || 'Imported';
    const portalName = parts[1] || 'Default portal';
    const moduleName = parts[2] || 'Default module';
    const suiteName = parts[3] || 'Default suite';

    console.log(`\n→ ${projectName} > ${portalName} > ${moduleName} > ${suiteName}`);

    // Project (workspace)
    const projectSlug = slugify(projectName);
    let project = await prisma.project.findUnique({ where: { slug: projectSlug } });
    if (!project) {
      project = await prisma.project.create({
        data: { name: projectName, slug: projectSlug },
      });
      createdProjects++;
      // Add memberships for every existing user so the workspace shows up for everyone.
      if (allUsers.length > 0) {
        await prisma.membership.createMany({
          data: allUsers.map(u => ({
            userId: u.id,
            projectId: project.id,
            role: u.role,
          })),
          skipDuplicates: true,
        });
      }
      console.log(`  + project "${project.name}"`);
    }

    // Portal
    let portal = await prisma.portal.findUnique({
      where: { projectId_name: { projectId: project.id, name: portalName } },
    });
    if (!portal) {
      portal = await prisma.portal.create({
        data: {
          name: portalName,
          slug: slugify(portalName),
          icon: guessPortalIcon(portalName),
          projectId: project.id,
        },
      });
      createdPortals++;
      console.log(`  + portal "${portal.name}"`);
    }

    // Module
    let mod = await prisma.module.findUnique({
      where: { portalId_name: { portalId: portal.id, name: moduleName } },
    });
    if (!mod) {
      mod = await prisma.module.create({
        data: { name: moduleName, portalId: portal.id },
      });
      createdModules++;
      console.log(`  + module "${mod.name}"`);
    }

    // Suite
    let suite = await prisma.suite.findUnique({
      where: { moduleId_name: { moduleId: mod.id, name: suiteName } },
    });
    if (!suite) {
      suite = await prisma.suite.create({
        data: { name: suiteName, moduleId: mod.id },
      });
      createdSuites++;
      console.log(`  + suite "${suite.name}"`);
    }

    // Test cases (idempotent on suiteId + title)
    for (const r of groupRows) {
      const title = (r[col['Title']] || '').trim();
      if (!title) {
        skippedCases++;
        continue;
      }
      const existing = await prisma.testCase.findFirst({
        where: { suiteId: suite.id, title },
        select: { id: true },
      });
      if (existing) {
        skippedCases++;
        continue;
      }

      const priority = mapPriority(r[col['Priority']]);
      const severity = mapSeverity(r[col['Severity']]);
      const type = mapType(r[col['Test Type']]);
      const desc = (r[col['Description']] || '').trim();
      const expected = (r[col['Expected Result']] || '').trim();
      const stepsRaw = r[col['Steps']] || r[col['Steps (Step)']] || '';
      const steps = parseSteps(stepsRaw);
      const preconditions = (r[col['Preconditions']] || '').trim();
      const author = (r[col['Created By']] || '').trim() || 'Imported';

      await prisma.testCase.create({
        data: {
          title,
          sub: desc.split('.')[0] || title.slice(0, 80),
          desc,
          preconditions,
          steps, // JSON array
          expected,
          priority,
          severity,
          type,
          status: 'Active',
          author,
          suiteId: suite.id,
        },
      });
      createdCases++;
    }
  }

  console.log('\n────────────────────────────────────────────');
  console.log(`Summary:`);
  console.log(`  + ${createdProjects} new project${createdProjects === 1 ? '' : 's'}`);
  console.log(`  + ${createdPortals} new portal${createdPortals === 1 ? '' : 's'}`);
  console.log(`  + ${createdModules} new module${createdModules === 1 ? '' : 's'}`);
  console.log(`  + ${createdSuites} new suite${createdSuites === 1 ? '' : 's'}`);
  console.log(`  + ${createdCases} new test case${createdCases === 1 ? '' : 's'}`);
  console.log(`  ${skippedCases} skipped (already-existing or blank rows)`);
}

function guessPortalIcon(name) {
  const l = name.toLowerCase();
  if (l.includes('mobile')) return 'ti-device-mobile';
  if (l.includes('admin')) return 'ti-shield-lock';
  if (l.includes('teacher')) return 'ti-school';
  if (l.includes('parent')) return 'ti-users';
  if (l.includes('student')) return 'ti-user';
  if (l.includes('web')) return 'ti-world';
  return null;
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
