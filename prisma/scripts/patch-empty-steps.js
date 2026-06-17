/* eslint-disable */
/**
 * One-off recovery: re-parse a CSV and update `steps` on test cases whose steps
 * are currently empty due to the duplicate-"Steps"-column bug in earlier imports.
 *
 * Usage:
 *   node prisma/scripts/patch-empty-steps.js "C:/path/to/file.csv"
 *
 * Matches rows to existing test cases by title within a Section Hierarchy.
 * Only updates rows where the DB's current steps array is empty — won't
 * overwrite cases you've since edited.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_CSV = 'C:/Users/ansaf/Downloads/simplied_system (1).csv';
const csvPath = process.argv[2] || DEFAULT_CSV;

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

function parseSteps(stepsRaw) {
  if (!stepsRaw) return [];
  return stepsRaw
    .split(/\n+/)
    .map(s => s.replace(/^\s*\d+\.\s*/, '').trim())
    .filter(Boolean);
}

async function main() {
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }
  const text = fs.readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
  const rows = parseCSV(text);
  if (rows.length < 2) {
    console.error('CSV looks empty');
    process.exit(1);
  }
  const header = rows[0];
  // FIRST occurrence wins — fixes the duplicate-"Steps"-column bug.
  const col = {};
  header.forEach((h, i) => {
    if (col[h] === undefined) col[h] = i;
  });

  if (col['Title'] === undefined || col['Steps'] === undefined) {
    console.error('CSV missing Title or Steps column');
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const title = (r[col['Title']] || '').trim();
    if (!title) continue;
    const stepsRaw = (r[col['Steps']] || '').trim();
    if (!stepsRaw) continue;
    const steps = parseSteps(stepsRaw);
    if (steps.length === 0) continue;

    // Find DB cases with matching title and currently-empty steps.
    const cases = await prisma.testCase.findMany({
      where: { title },
      select: { id: true, caseNum: true, steps: true, title: true },
    });
    if (cases.length === 0) {
      notFound++;
      continue;
    }
    for (const c of cases) {
      const existing = Array.isArray(c.steps) ? c.steps : [];
      if (existing.length > 0) {
        skipped++;
        continue;
      }
      await prisma.testCase.update({
        where: { id: c.id },
        data: { steps },
      });
      console.log(`  ✓ TC-${c.caseNum} | ${c.title.slice(0, 60)} (${steps.length} step(s))`);
      updated++;
    }
  }

  console.log('────────────────────────────────────────────');
  console.log(
    `Done: ${updated} updated · ${skipped} skipped (already had steps) · ${notFound} CSV rows with no matching test case`,
  );
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
