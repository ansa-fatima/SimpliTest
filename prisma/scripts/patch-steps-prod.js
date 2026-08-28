/* eslint-disable */
/**
 * Patch existing prod test cases with Test Steps parsed from an xlsx file.
 *
 * Only updates cases whose current `steps` array is empty — won't overwrite
 * anything you've manually edited. Idempotent: re-runs are no-ops because
 * patched rows then have non-empty steps.
 *
 * Setup:
 *   XLSX_PATH=C:/path/to/SimpliEd_TestCases_2.xlsx
 * already in .env.import; all other vars same as bulk-import-prod.js.
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
// Allow XLSX_PATH override on the CLI (node script.js path/to/file.xlsx)
const XLSX_PATH = process.argv[2] || env.XLSX_PATH;

let cookie = '';

async function req(method, pathname, body) {
  const r = await fetch(BASE + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!r.ok) throw new Error(`${method} ${pathname} → ${r.status}: ${text.slice(0, 200)}`);
  return json;
}

// Split TestRail's freeform "Test Steps" into discrete strings — newlines or
// numbered prefixes ("1. ", "2) ") become separators; empty lines dropped.
function parseSteps(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/\n+/)
    .map(s => s.replace(/^\s*\d+[\.\)]\s*/, '').trim())
    .filter(Boolean);
}

(async () => {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`xlsx not found: ${XLSX_PATH}`);
    process.exit(1);
  }
  console.log(`→ Logging in @ ${BASE}`);
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

  console.log(`→ Loading every case in "${project.name}" (this can take a minute)…`);
  // Pull EVERY case in one shot with the new pageSize cap. Build a map keyed by
  // (parentId, normalisedTitle) so we can find matches in O(1) per xlsx row.
  const all = await req('GET', `/api/test-cases?projectId=${project.id}&pageSize=5000`);
  const items = all.items || [];
  console.log(`  loaded ${items.length} cases`);

  const norm = s =>
    String(s || '')
      .trim()
      .toLowerCase();
  const caseMap = new Map();
  for (const c of items) {
    const parentId = c.suiteId || c.moduleId || c.portalId;
    if (!parentId) continue;
    caseMap.set(`${parentId}|${norm(c.title)}`, c);
  }

  // Also map prod's hierarchy so we can translate (portalName, moduleName, suiteName)
  // from the xlsx into the actual parent id.
  const portals = await req('GET', `/api/portals?projectId=${project.id}`);
  const parentIdFor = (portalName, moduleName, suiteName) => {
    const portal = portals.find(p => norm(p.name) === norm(portalName));
    if (!portal) return null;
    if (!moduleName) return portal.id;
    const mod = portal.modules.find(m => norm(m.name) === norm(moduleName));
    if (!mod) return null;
    if (!suiteName || norm(suiteName) === 'general') return mod.id;
    // Walk nested suites depth-first.
    const find = suites => {
      for (const s of suites) {
        if (norm(s.name) === norm(suiteName)) return s.id;
        const inChild = find(s.children || []);
        if (inChild) return inChild;
      }
      return null;
    };
    return find(mod.suites);
  };

  // ── Walk xlsx ───────────────────────────────────────────────
  console.log(`→ Reading ${XLSX_PATH}`);
  const wb = XLSX.readFile(XLSX_PATH);
  const sheets = wb.SheetNames.filter(n => n.toLowerCase() !== 'summary');

  let patched = 0,
    skippedHasSteps = 0,
    noMatch = 0,
    noStepsInXlsx = 0;

  for (const sheetName of sheets) {
    const ws = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, range: 1, header: 1 });
    if (grid.length < 2) continue;
    const header = grid[0].map(h => String(h || '').trim());
    const col = name => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
    const iTitle = col('Title');
    const iModule = col('Module');
    const iSection = col('Section');
    const iSteps = col('Test Steps');
    if (iTitle < 0 || iSteps < 0) {
      console.log(`! Sheet "${sheetName}" missing Title or Test Steps — skipping`);
      continue;
    }
    let sheetPatched = 0,
      sheetSkipHasSteps = 0,
      sheetNoMatch = 0,
      sheetNoSteps = 0;

    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      const title = String(r[iTitle] || '').trim();
      if (!title) continue;
      const stepsRaw = String(r[iSteps] || '').trim();
      const steps = parseSteps(stepsRaw);
      if (steps.length === 0) {
        sheetNoSteps++;
        continue;
      }

      const moduleName = String((iModule >= 0 ? r[iModule] : '') || '').trim();
      const sectionName = String((iSection >= 0 ? r[iSection] : '') || '').trim();
      const parentId = parentIdFor(sheetName, moduleName, sectionName);
      if (!parentId) {
        sheetNoMatch++;
        continue;
      }
      const tc = caseMap.get(`${parentId}|${norm(title)}`);
      if (!tc) {
        sheetNoMatch++;
        continue;
      }

      // Skip if the case already has steps — we never overwrite user edits.
      const existing = Array.isArray(tc.steps) ? tc.steps : [];
      if (existing.length > 0) {
        sheetSkipHasSteps++;
        continue;
      }

      try {
        await req('PATCH', `/api/test-cases/${tc.id}`, { steps });
        sheetPatched++;
      } catch (e) {
        console.log(`    ✗ patch ${tc.id} (${title.slice(0, 40)}): ${e.message}`);
      }
    }

    patched += sheetPatched;
    skippedHasSteps += sheetSkipHasSteps;
    noMatch += sheetNoMatch;
    noStepsInXlsx += sheetNoSteps;
    console.log(
      `📁 ${sheetName.padEnd(18)} | +${String(sheetPatched).padStart(4)} patched · skipped ${sheetSkipHasSteps} (already had steps) · ${sheetNoMatch} no match · ${sheetNoSteps} empty steps in xlsx`,
    );
  }

  console.log('\n────────────────────────────────────────────');
  console.log(
    `Done: ${patched} patched · ${skippedHasSteps} skipped (already had steps) · ${noMatch} no match · ${noStepsInXlsx} no steps in xlsx`,
  );
})().catch(e => {
  console.error('\n✗ Aborted:', e.message);
  process.exit(1);
});
