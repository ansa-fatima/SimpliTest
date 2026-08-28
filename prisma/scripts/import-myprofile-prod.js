/* eslint-disable */
/**
 * One-off: import SimpliEd_MyProfile_TestCases.xlsx into prod.
 *
 * Unlike bulk-import-prod.js (one sheet per portal, portal name = sheet name),
 * this file has ONE sheet with Portal/Module/Section columns already filled in
 * per-row, so we read the hierarchy from the row data instead of the sheet name.
 *
 * "Created By" is overridden to the importing user's real name — the xlsx's
 * own Created By column (from the original TestRail export) is discarded.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ENV_PATH = path.join(__dirname, '../../.env.import');
const env = fs
  .readFileSync(ENV_PATH, 'utf-8')
  .split(/\r?\n/)
  .reduce((o, l) => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) o[m[1]] = m[2];
    return o;
  }, {});

const BASE = env.BASE_URL.replace(/\/$/, '');
const XLSX_PATH = process.argv[2];
const CREATOR_NAME = process.argv[3] || 'Ansa Fatima';

let cookie = '';
async function req(method, pathname, body) {
  const r = await fetch(BASE + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!r.ok) throw new Error(`${method} ${pathname} → ${r.status}: ${text.slice(0, 300)}`);
  return json;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function rowsToCSV(headers, rows) {
  const out = [headers.map(csvEscape).join(',')];
  for (const row of rows) out.push(headers.map(h => csvEscape(row[h])).join(','));
  return out.join('\n');
}

function normalisePriority(p) {
  const s = (p || '').trim().toLowerCase();
  if (['critical', 'high', 'urgent', 'major'].includes(s)) return 'High';
  if (['moderate', 'medium', 'normal'].includes(s)) return 'Medium';
  if (['low', 'minor'].includes(s)) return 'Low';
  return 'Medium';
}
function normaliseType(t) {
  const s = (t || '').trim().toLowerCase();
  if (!s) return 'Functional';
  if (s.includes('ui') || s.includes('interface') || s.includes('responsive')) return 'UI';
  if (s.includes('regression')) return 'Regression';
  if (s.includes('smoke')) return 'Smoke';
  if (s.includes('sanity')) return 'Sanity';
  if (s === 'api') return 'API';
  return 'Functional';
}

(async () => {
  if (!XLSX_PATH || !fs.existsSync(XLSX_PATH)) {
    console.error('Usage: node import-myprofile-prod.js <path-to-xlsx> ["Creator Name"]');
    process.exit(1);
  }
  console.log(`→ Logging in as ${env.LOGIN_EMAIL} @ ${BASE}`);
  await req('POST', '/api/auth/login', {
    identifier: env.LOGIN_EMAIL,
    password: env.LOGIN_PASSWORD,
  });

  const projs = await req('GET', '/api/projects');
  const list = Array.isArray(projs) ? projs : projs.projects || projs.items || [];
  const project = list.find(p => p.name.toLowerCase() === env.PROJECT_NAME.toLowerCase());
  if (!project) {
    console.error('Project not found:', env.PROJECT_NAME);
    process.exit(1);
  }
  console.log(`  ✓ project: ${project.name}`);

  const wb = XLSX.readFile(XLSX_PATH);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, range: 1, header: 1 });
  const header = grid[0].map(h => String(h || '').trim());
  const idx = name => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const iTitle = idx('Title'),
    iPortal = idx('Portal'),
    iModule = idx('Module'),
    iSection = idx('Section');
  const iType = idx('Type'),
    iPriority = idx('Priority'),
    iPrecon = idx('Preconditions');
  const iSteps = idx('Test Steps'),
    iExpected = idx('Expected Result');

  console.log(`→ Reading sheet "${sheetName}" — header: ${header.join(', ')}`);

  const csvRows = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const title = String(r[iTitle] || '').trim();
    if (!title) continue;
    const portalName = String((iPortal >= 0 ? r[iPortal] : '') || '').trim();
    const moduleName = String((iModule >= 0 ? r[iModule] : '') || '').trim() || 'General';
    const sectionName = String((iSection >= 0 ? r[iSection] : '') || '').trim();
    if (!portalName) {
      console.log(`  ! row ${i + 1} has no Portal — skipping: ${title.slice(0, 50)}`);
      continue;
    }
    csvRows.push({
      'Section Hierarchy': sectionName
        ? `${portalName} > ${moduleName} > ${sectionName}`
        : `${portalName} > ${moduleName}`,
      Title: title,
      Description: '',
      Preconditions: iPrecon >= 0 ? r[iPrecon] : '',
      Steps: iSteps >= 0 ? r[iSteps] : '',
      'Expected Result': iExpected >= 0 ? r[iExpected] : '',
      Priority: normalisePriority(iPriority >= 0 ? r[iPriority] : ''),
      Severity: '',
      'Test Type': normaliseType(iType >= 0 ? r[iType] : ''),
      'Created By': CREATOR_NAME, // override — never the xlsx's own Created By column
    });
  }

  if (csvRows.length === 0) {
    console.log('No rows with a Title found — nothing to import.');
    process.exit(0);
  }

  console.log(`  ✓ ${csvRows.length} case(s), creator set to "${CREATOR_NAME}"`);
  console.log(
    `  sample hierarchy: "${csvRows[0]['Section Hierarchy']}" → "${csvRows[0].Title.slice(0, 60)}"`,
  );

  const csv = rowsToCSV(
    [
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
    ],
    csvRows,
  );

  const res = await req('POST', '/api/test-cases/import-csv', {
    projectId: project.id,
    csv,
    stripProjectPrefix: false,
  });

  console.log('\n────────────────────────────────────────────');
  console.log(
    `Done: +${res.createdCases} cases · +${res.createdPortals}p +${res.createdModules}m +${res.createdSuites}s · skipped ${res.skipped?.length || 0}`,
  );
  if (res.skipped?.length) {
    for (const s of res.skipped.slice(0, 10)) console.log(`  · row ${s.row}: ${s.reason}`);
  }
})().catch(e => {
  console.error('\n✗ Aborted:', e.message);
  process.exit(1);
});
