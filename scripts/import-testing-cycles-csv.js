/* eslint-disable */
// Imports a "Testing Cycles" CSV export (Date, Module, Feature, Environment,
// Platform, Version, Cycle Type, Ticket Link, Issue Count, Critical/Major/Minor,
// Done, Remaining Issue Count, Status, Description, Feedback) into the LOCAL
// dev database as Manual quick-log test cycles, so the feature can be
// exercised against real historical data.
//
// Each row becomes one Manual TestCycle:
//   - scopeType 'All' / scopeId null — the CSV has no real Portal/Module tree
//     to attach to, so these land as free-text quick logs (moduleName /
//     featureName are just labels, same as picking "quick log" in the app
//     without selecting from the hierarchy).
//   - status 'Completed', completedAt = the CSV date — these are historical
//     records of testing already performed, not active runs.
//   - description = CSV Description, with Feedback appended when present.
//
//   node scripts/import-testing-cycles-csv.js "C:/path/to/file.csv"

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_ID = 'cmpgke85c0000bvz81wi7j6e5'; // SimpliEd System
const CSV_PATH = process.argv[2] || 'C:/Users/ansaf/Downloads/Dexter Stark - Testing Cycles.csv';

// Same RFC-4180-ish parser as lib/csv.ts, inlined so this plain CommonJS
// script doesn't need to import the app's TS module.
function parseCSV(input) {
  const text = input.replace(/^\uFEFF/, '');
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

const clean = s => (s ?? '').trim();
const orNull = s => {
  const v = clean(s);
  return v === '' || v === '-' ? null : v;
};
const numOrZero = s => {
  const v = clean(s);
  if (v === '' || v === '-') return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
function parseDate(s) {
  const v = clean(s);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, month, day, year] = m;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

const CATEGORIES = new Set(['Stability', 'Regression', 'UI', 'Functional', 'Performance']);

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(raw);
  const dataRows = rows.slice(2); // row 0 = header, row 1 = Critical/Major/Minor sub-header

  let created = 0;
  let skipped = 0;

  for (const r of dataRows) {
    const date = parseDate(r[0]);
    if (!date) {
      skipped++;
      continue; // blank/trailing rows have no date — nothing to import
    }

    const module_ = orNull(r[1]);
    const feature = orNull(r[2]);
    const environment = orNull(r[3]);
    const platform = orNull(r[4]);
    const version = orNull(r[5]);
    const cycleTypeRaw = orNull(r[6]);
    const cycleCategory = cycleTypeRaw && CATEGORIES.has(cycleTypeRaw) ? cycleTypeRaw : null;
    const ticketLink = orNull(r[7]);
    const issueCount = numOrZero(r[8]);
    const critical = numOrZero(r[9]);
    const major = numOrZero(r[10]);
    const minor = numOrZero(r[11]);
    const done = numOrZero(r[12]);
    const remaining = numOrZero(r[13]);
    const description = clean(r[15]);
    const feedback = clean(r[16]);

    const fullDescription = feedback
      ? description
        ? `${description}\n\nFeedback: ${feedback}`
        : `Feedback: ${feedback}`
      : description;

    const nameCore = feature || module_ || cycleTypeRaw || 'Quick log';
    const dateLabel = `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
    const name = `${nameCore} — ${dateLabel}`.slice(0, 200);

    await prisma.testCycle.create({
      data: {
        name,
        description: fullDescription,
        status: 'Completed',
        mode: 'Manual',
        scopeType: 'All',
        scopeId: null,
        projectId: PROJECT_ID,
        completedAt: date,
        createdAt: date,
        moduleName: module_,
        featureName: feature,
        environment,
        platform,
        version,
        cycleCategory,
        ticketLink,
        issueCount,
        criticalCount: critical,
        majorCount: major,
        minorCount: minor,
        doneCount: done,
        remainingCount: remaining,
      },
    });
    created++;
  }

  console.log(`Imported ${created} testing cycles (${skipped} blank rows skipped).`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
