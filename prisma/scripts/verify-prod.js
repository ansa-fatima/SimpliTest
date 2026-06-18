/* eslint-disable */
// Quick post-deploy verification — confirms the live deployment exposes the new
// per-portal/per-module testCase counts and reports how many cases now live
// directly under a module (i.e. were moved up by the cleanup migration).
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

(async () => {
  const BASE = env.BASE_URL.replace(/\/$/, '');
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: env.LOGIN_EMAIL, password: env.LOGIN_PASSWORD }),
  });
  if (!r.ok) {
    console.log('login failed:', r.status, (await r.text()).slice(0, 200));
    process.exit(1);
  }
  const cookie = r.headers.get('set-cookie').split(';')[0];

  const projs = await fetch(BASE + '/api/projects', { headers: { Cookie: cookie } }).then(r =>
    r.json(),
  );
  const list = Array.isArray(projs) ? projs : projs.projects || projs.items || [];
  const p = list.find(p => p.name.toLowerCase() === env.PROJECT_NAME.toLowerCase());
  if (!p) {
    console.log('project not found:', env.PROJECT_NAME);
    process.exit(1);
  }

  const portals = await fetch(BASE + '/api/portals?projectId=' + p.id, {
    headers: { Cookie: cookie },
  }).then(r => r.json());
  console.log(`Project: ${p.name}  (${portals.length} portals)`);
  console.log('────────────────────────────────────────────');

  let grandPortal = 0,
    grandModule = 0,
    grandSuite = 0,
    grandGeneralLeft = 0;
  for (const portal of portals) {
    const portalDirect = portal._count?.testCases || 0;
    let moduleDirect = 0,
      suiteCases = 0,
      generalSuitesLeft = 0;
    for (const m of portal.modules) {
      moduleDirect += m._count?.testCases || 0;
      const sum = s => (s._count?.testCases || 0) + s.children.reduce((a, c) => a + sum(c), 0);
      for (const s of m.suites) {
        suiteCases += sum(s);
        if (s.name === 'General' && !s.parentId) generalSuitesLeft++;
      }
    }
    grandPortal += portalDirect;
    grandModule += moduleDirect;
    grandSuite += suiteCases;
    grandGeneralLeft += generalSuitesLeft;
    console.log(
      `· ${portal.name.padEnd(20)} | ${String(portalDirect).padStart(4)} portal-direct | ${String(moduleDirect).padStart(5)} module-direct | ${String(suiteCases).padStart(5)} in suites | ${generalSuitesLeft} "General" suites left`,
    );
  }
  console.log('────────────────────────────────────────────');
  console.log(
    `Totals: ${grandPortal} portal-direct · ${grandModule} module-direct · ${grandSuite} in suites · ${grandGeneralLeft} legacy "General" suites remaining`,
  );
  console.log(`Grand total cases: ${grandPortal + grandModule + grandSuite}`);
})();
