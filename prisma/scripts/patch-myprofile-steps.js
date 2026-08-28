/* eslint-disable */
/**
 * Fix inline-numbered steps ("1. Do X. 2. Do Y. 3. Do Z." all on one line, no
 * newlines) for the My Profile Screen import — the standard newline-based
 * splitter can't break these apart, so they landed as one run-on string.
 *
 * Splits on a digit+period+space that starts a new sentence (preceded by
 * start-of-string or whitespace), strips the numbering, drops empties.
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
  if (!r.ok) throw new Error(`${method} ${pathname} → ${r.status}: ${text.slice(0, 200)}`);
  return json;
}

// Splits "1. Do X. 2. Do Y. 3. Do Z." into ["Do X.", "Do Y.", "Do Z."]
// Numbering token must be at the very start, or preceded by whitespace right
// after a sentence-ending period — avoids false-splitting on "e.g. 2 items".
function splitInlineSteps(raw) {
  if (!raw) return [];
  const parts = raw.split(/(?:^|(?<=\.\s))(\d+)\.\s+/).filter(Boolean);
  // split() with a capturing group interleaves the captured numbers into the
  // array — drop pure-digit entries, keep the text segments.
  const steps = parts
    .filter(p => !/^\d+$/.test(p))
    .map(s => s.trim())
    .filter(Boolean);
  return steps.length > 0 ? steps : [raw.trim()];
}

(async () => {
  console.log(`→ Logging in @ ${BASE}`);
  await req('POST', '/api/auth/login', {
    identifier: env.LOGIN_EMAIL,
    password: env.LOGIN_PASSWORD,
  });

  const projs = await req('GET', '/api/projects');
  const list = Array.isArray(projs) ? projs : projs.items || projs.projects || [];
  const project = list.find(p => p.name.toLowerCase() === env.PROJECT_NAME.toLowerCase());

  const wb = XLSX.readFile(XLSX_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, range: 1, header: 1 });
  const header = grid[0].map(h => String(h || '').trim());
  const idx = n => header.findIndex(h => h.toLowerCase() === n.toLowerCase());
  const iTitle = idx('Title'),
    iSteps = idx('Test Steps');

  const portals = await req('GET', `/api/portals?projectId=${project.id}`);
  const teacher = portals.find(p => p.name.toLowerCase() === 'teacher portal');
  const settings = teacher.modules.find(m => m.name === 'Settings');
  const suite = settings.suites.find(s => s.name === 'My Profile Screen');
  const existing = await req('GET', `/api/test-cases?suiteId=${suite.id}&pageSize=200`);
  const byTitle = new Map(existing.items.map(tc => [tc.title.trim(), tc]));

  let patched = 0,
    skipped = 0,
    noMatch = 0;
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const title = String(r[iTitle] || '').trim();
    if (!title) continue;
    const tc = byTitle.get(title);
    if (!tc) {
      noMatch++;
      continue;
    }
    const steps = splitInlineSteps(String(r[iSteps] || ''));
    if (steps.length <= 1) {
      skipped++;
      continue;
    }
    await req('PATCH', `/api/test-cases/${tc.id}`, { steps });
    patched++;
  }
  console.log(
    `Done: ${patched} patched · ${skipped} already single-step · ${noMatch} no title match`,
  );
})().catch(e => {
  console.error('Aborted:', e.message);
  process.exit(1);
});
