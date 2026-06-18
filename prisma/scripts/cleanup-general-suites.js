/* eslint-disable */
/**
 * One-off cleanup: walk every "General"-named root suite, move its test cases
 * up to the parent module (no suite), then delete the now-empty suite.
 *
 * Runs against the live API using .env.import — same creds as bulk-import-prod.
 * Idempotent: re-runs are no-ops because matching suites disappear after step 1.
 */
const fs = require('fs');
const path = require('path');

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
let cookie = '';

async function jsonReq(method, pathname, body) {
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

(async () => {
  console.log(`→ Logging in @ ${BASE}`);
  await jsonReq('POST', '/api/auth/login', {
    identifier: env.LOGIN_EMAIL,
    password: env.LOGIN_PASSWORD,
  });

  const projs = await jsonReq('GET', '/api/projects');
  const list = Array.isArray(projs) ? projs : projs.projects || projs.items || [];
  const p = list.find(p => p.name.toLowerCase() === env.PROJECT_NAME.toLowerCase());
  if (!p) {
    console.error('Project not found:', env.PROJECT_NAME);
    process.exit(1);
  }

  const portals = await jsonReq('GET', `/api/portals?projectId=${p.id}`);
  let movedCases = 0;
  let deletedSuites = 0;
  let skippedSuites = 0;

  for (const portal of portals) {
    for (const m of portal.modules) {
      const generalRoot = m.suites.filter(s => s.name === 'General' && !s.parentId);
      if (generalRoot.length === 0) continue;
      console.log(`\n📁 ${portal.name} › ${m.name} — ${generalRoot.length} General suite(s)`);

      for (const suite of generalRoot) {
        if (suite.children && suite.children.length > 0) {
          console.log(`  · "${suite.name}" has children — skipping`);
          skippedSuites++;
          continue;
        }

        // Page through every case in this suite.
        let page = 1;
        const movedHere = [];
        while (true) {
          const r = await jsonReq(
            'GET',
            `/api/test-cases?suiteId=${suite.id}&page=${page}&pageSize=200`,
          );
          const items = r.items || [];
          if (items.length === 0) break;
          for (const tc of items) {
            try {
              await jsonReq('PATCH', `/api/test-cases/${tc.id}`, { moduleId: m.id });
              movedHere.push(tc.id);
            } catch (e) {
              console.log(`    ✗ patch ${tc.id}: ${e.message}`);
            }
          }
          if (items.length < 200) break;
          // After PATCH the page shifts (cases leave this suite); always re-query page 1.
          page = 1;
        }

        movedCases += movedHere.length;
        console.log(`  · Moved ${movedHere.length} case(s) from "${suite.name}" → module direct`);

        // Now the suite should be empty — delete it.
        try {
          await jsonReq('DELETE', `/api/features/${suite.id}`);
          deletedSuites++;
          console.log(`  ✓ Deleted empty suite "${suite.name}"`);
        } catch (e) {
          console.log(`  ✗ Could not delete "${suite.name}": ${e.message}`);
        }
      }
    }
  }

  console.log('\n────────────────────────────────────────────');
  console.log(
    `Done: moved ${movedCases} case(s) · deleted ${deletedSuites} empty suite(s) · skipped ${skippedSuites}`,
  );
})().catch(e => {
  console.error('\n✗ Aborted:', e.message);
  process.exit(1);
});
