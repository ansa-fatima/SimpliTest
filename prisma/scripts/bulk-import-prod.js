/* eslint-disable */
/**
 * Bulk-import a SINGLE TestRail .xlsx with one sheet per portal into LIVE Simplitest.
 *
 * Each sheet:
 *   • Row 0  → banner ("Admin Portal — 2211 Test Cases")     [ignored]
 *   • Row 1  → column header (Case ID, Portal, Module, Section, Title, Type, …)
 *   • Row 2+ → data
 *
 * Mapping:
 *   • Sheet name        → Portal     (e.g. "Admin Portal")
 *   • Row "Module"      → Module
 *   • Row "Section"     → Suite      (treated as feature, per your data layout)
 *   • Row "Title"       → Title
 *   • Empty Module/Section → "General"
 *   • "Summary" sheet   → skipped
 *
 * Setup:
 *   1. Create .env.import in the project root (already gitignored) with:
 *        BASE_URL=https://simplitest.apps.ztechuniverse.com
 *        LOGIN_EMAIL=you@example.com
 *        LOGIN_PASSWORD=...
 *        PROJECT_NAME=SimpliEd System
 *        XLSX_PATH=C:/Users/ansaf/Downloads/SimpliEd_TestCases.xlsx
 *   2. node prisma/scripts/bulk-import-prod.js
 *
 * Idempotent — re-runs skip cases by (suite, title) match. System-generated caseNum;
 * TestRail's C-IDs are discarded.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// ─── Load .env.import ──────────────────────────────────────
const ENV_PATH = path.join(__dirname, '../../.env.import');
if (!fs.existsSync(ENV_PATH)) {
  console.error(`Missing .env.import at ${ENV_PATH}`);
  console.error(`Create it with: BASE_URL, LOGIN_EMAIL, LOGIN_PASSWORD, PROJECT_NAME, XLSX_PATH`);
  process.exit(1);
}
for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  process.env[m[1]] = v;
}

const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const LOGIN_EMAIL = process.env.LOGIN_EMAIL || '';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || '';
const PROJECT_NAME = process.env.PROJECT_NAME || '';
const XLSX_PATH = process.env.XLSX_PATH || '';

for (const [k, v] of Object.entries({
  BASE_URL,
  LOGIN_EMAIL,
  LOGIN_PASSWORD,
  PROJECT_NAME,
  XLSX_PATH,
})) {
  if (!v) {
    console.error(`Missing required env var: ${k}`);
    process.exit(1);
  }
}
if (!fs.existsSync(XLSX_PATH)) {
  console.error(`XLSX_PATH not found: ${XLSX_PATH}`);
  process.exit(1);
}

// ─── HTTP helpers ──────────────────────────────────────────
let sessionCookie = '';

async function postJSON(pathname, body) {
  const r = await fetch(`${BASE_URL}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) {
    const parts = setCookie.split(/,(?=\s*\w+=)/);
    const cookies = parts.map(p => p.split(';')[0].trim()).filter(Boolean);
    if (cookies.length) sessionCookie = cookies.join('; ');
  }
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!r.ok) {
    const msg = (json && (json.error || json.message)) || text.slice(0, 300) || `HTTP ${r.status}`;
    throw new Error(`POST ${pathname} → ${r.status}: ${msg}`);
  }
  return json;
}

async function getJSON(pathname) {
  const r = await fetch(`${BASE_URL}${pathname}`, {
    headers: sessionCookie ? { Cookie: sessionCookie } : {},
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* */
  }
  if (!r.ok) {
    const msg = (json && (json.error || json.message)) || text.slice(0, 300) || `HTTP ${r.status}`;
    throw new Error(`GET ${pathname} → ${r.status}: ${msg}`);
  }
  return json;
}

// ─── CSV builder ───────────────────────────────────────────
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function rowsToCSV(headers, rows) {
  const out = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    out.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  return out.join('\n');
}

// ─── Field normalisers ─────────────────────────────────────
const VALID_TYPES = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];
function normaliseType(t) {
  const s = (t || '').trim().toLowerCase();
  if (!s) return 'Functional';
  if (s.includes('ui') || s.includes('interface') || s.includes('responsive')) return 'UI';
  if (s.includes('regression')) return 'Regression';
  if (s.includes('smoke')) return 'Smoke';
  if (s.includes('sanity')) return 'Sanity';
  if (s === 'api') return 'API';
  // Other, Usability, Performance, blank → default
  return 'Functional';
}
function normalisePriority(p) {
  const s = (p || '').trim().toLowerCase();
  if (['critical', 'high', 'urgent', 'major'].includes(s)) return 'High';
  if (['moderate', 'medium', 'normal'].includes(s)) return 'Medium';
  if (['low', 'minor'].includes(s)) return 'Low';
  return 'Medium';
}

// ─── Sheet → CSV-row[] ─────────────────────────────────────
function sheetToCsvRows(ws, portalName) {
  // range:1 → start at row index 1 (the actual header row); header:1 → return 2D array
  const grid = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, range: 1, header: 1 });
  if (grid.length < 2) return [];

  const header = grid[0].map(h => String(h || '').trim());
  const idx = name => {
    const lc = name.toLowerCase();
    return header.findIndex(h => h.toLowerCase() === lc);
  };
  const iTitle = idx('Title');
  const iModule = idx('Module');
  const iSection = idx('Section');
  const iType = idx('Type');
  const iPriority = idx('Priority');
  const iPrecon = idx('Preconditions');
  const iSteps = idx('Test Steps');
  const iExpected = idx('Expected Result');
  const iCreatedBy = idx('Created By');

  if (iTitle < 0) {
    throw new Error(`Sheet has no "Title" column. Got: ${header.join(', ')}`);
  }

  const out = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const title = String(r[iTitle] || '').trim();
    if (!title) continue;
    const moduleName = String((iModule >= 0 ? r[iModule] : '') || '').trim() || 'General';
    const sectionName = String((iSection >= 0 ? r[iSection] : '') || '').trim() || 'General';

    out.push({
      'Section Hierarchy': `${portalName} > ${moduleName} > ${sectionName}`,
      Title: title,
      Description: '',
      Preconditions: iPrecon >= 0 ? r[iPrecon] : '',
      Steps: iSteps >= 0 ? r[iSteps] : '',
      'Expected Result': iExpected >= 0 ? r[iExpected] : '',
      Priority: normalisePriority(iPriority >= 0 ? r[iPriority] : ''),
      Severity: '', // not in this export
      'Test Type': normaliseType(iType >= 0 ? r[iType] : ''),
      'Created By': iCreatedBy >= 0 ? r[iCreatedBy] : '',
    });
  }
  return out;
}

const CSV_HEADERS = [
  'Section Hierarchy',
  'Title',
  'Description',
  'Preconditions',
  'Steps',
  'Expected Result',
  'Priority',
  'Severity',
  'Test Type',
  'Created By',
];

// ─── Main ──────────────────────────────────────────────────
async function main() {
  console.log(`→ Logging in as ${LOGIN_EMAIL} @ ${BASE_URL}`);
  await postJSON('/api/auth/login', { identifier: LOGIN_EMAIL, password: LOGIN_PASSWORD });
  console.log(`  ✓ session established`);

  console.log(`→ Locating project "${PROJECT_NAME}"`);
  const projects = await getJSON('/api/projects');
  const list = Array.isArray(projects) ? projects : projects.projects || projects.items || [];
  const project = list.find(
    p => (p.name || '').trim().toLowerCase() === PROJECT_NAME.trim().toLowerCase(),
  );
  if (!project) {
    console.error(
      `Project "${PROJECT_NAME}" not found. Available: ${list.map(p => p.name).join(', ') || '(none)'}`,
    );
    process.exit(1);
  }
  console.log(`  ✓ project id: ${project.id}`);

  console.log(`→ Reading ${XLSX_PATH}`);
  const wb = XLSX.readFile(XLSX_PATH);
  const sheetNames = wb.SheetNames.filter(n => n.toLowerCase() !== 'summary');
  console.log(`  ✓ ${sheetNames.length} sheet(s): ${sheetNames.join(', ')}`);

  const summary = [];

  for (const sheetName of sheetNames) {
    const ws = wb.Sheets[sheetName];
    let csvRows;
    try {
      csvRows = sheetToCsvRows(ws, sheetName);
    } catch (e) {
      console.log(`\n✗ Sheet "${sheetName}" — ${e.message}`);
      summary.push({ sheet: sheetName, error: e.message });
      continue;
    }
    if (csvRows.length === 0) {
      console.log(`\n· Sheet "${sheetName}" — no data rows, skipping`);
      continue;
    }
    console.log(`\n📁 Sheet "${sheetName}" — ${csvRows.length} test case(s)`);

    const csv = rowsToCSV(CSV_HEADERS, csvRows);
    // Quick sanity print
    console.log(
      `  · sample hierarchy: "${csvRows[0]['Section Hierarchy']}" → "${csvRows[0].Title.slice(0, 60)}"`,
    );

    try {
      const res = await postJSON('/api/test-cases/import-csv', {
        projectId: project.id,
        csv,
        stripProjectPrefix: false, // We already prefixed the sheet/portal name
      });
      console.log(
        `  ✓ +${res.createdCases} cases · +${res.createdPortals}p +${res.createdModules}m +${res.createdSuites}s · skipped ${res.skipped?.length || 0}`,
      );
      summary.push({ sheet: sheetName, ...res, rows: csvRows.length });
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      summary.push({ sheet: sheetName, error: e.message });
    }
  }

  // ── Final summary ──
  console.log('\n────────────────────────────────────────────');
  const totals = summary.reduce(
    (acc, s) => {
      acc.cases += s.createdCases || 0;
      acc.portals += s.createdPortals || 0;
      acc.modules += s.createdModules || 0;
      acc.suites += s.createdSuites || 0;
      acc.errors += s.error ? 1 : 0;
      return acc;
    },
    { cases: 0, portals: 0, modules: 0, suites: 0, errors: 0 },
  );
  console.log(
    `Done: +${totals.cases} cases · +${totals.portals} portals · +${totals.modules} modules · +${totals.suites} suites · ${totals.errors} sheet error(s)`,
  );
  if (totals.errors) {
    console.log('\nSheets with errors:');
    for (const s of summary.filter(x => x.error)) {
      console.log(`  · ${s.sheet} — ${s.error}`);
    }
  }
}

main().catch(e => {
  console.error('\n✗ Aborted:', e.message);
  process.exit(1);
});
