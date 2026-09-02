/* eslint-disable */
// Replicates the same "Testing Cycles" xlsx import that's already in local
// dev into PRODUCTION, via the app's own authenticated API (login using the
// credentials in .env.import) — never a direct database connection. Creates
// the same missing Module/Suite ("feature folder") structure under the real
// tree first, then posts each row as a Manual quick-log cycle.
//
// Mirrors scripts/import-testing-cycles-xlsx.js's mapping exactly — see that
// file for the full rationale per PORTAL value.
//
//   node scripts/post-testing-cycles-to-prod.js

require('dotenv').config({ path: '.env.import' });
const fs = require('fs');

const BASE_URL = 'https://simplitest.srv3.simpliedtech.com';
const { LOGIN_EMAIL, LOGIN_PASSWORD, PROJECT_NAME } = process.env;
const DATA_PATH =
  'C:/Users/ansaf/AppData/Local/Temp/claude/C--Users-ansaf-Desktop-SmpliTest/249c0ad0-2cdd-4f14-8783-8ebfd1b6e402/scratchpad/testing_cycles.json';

const MODULE_ALIAS = { Academic: 'Academics' };
const CATEGORIES = new Set(['Stability', 'Regression', 'UI', 'Functional', 'Performance']);

let cookie = '';

async function call(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()[0]
      : res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

function resolveLocation(row) {
  if (row.portal === 'Admin Portal') {
    return {
      portalName: 'Admin Portal',
      moduleName: row.module ? (MODULE_ALIAS[row.module] ?? row.module) : null,
      featureName: row.feature ?? null,
    };
  }
  if (row.portal === 'Parent Portal') {
    return {
      portalName: 'SimpliEd - Mobile App',
      moduleName: 'Parent Portal',
      featureName: row.module ?? null,
    };
  }
  if (row.portal === 'Teacher Portal') {
    return {
      portalName: 'Teacher App',
      moduleName: row.module ?? 'Teacher App',
      featureName: row.feature ?? null,
    };
  }
  return {
    portalName: null,
    moduleName: row.module ?? null,
    featureName: row.feature ?? null,
    forceAll: true,
  };
}

function buildDescription(row) {
  const parts = [];
  if (row.description) parts.push(row.description);
  if (row.feedback) parts.push(`Feedback: ${row.feedback}`);
  if (row.notes) parts.push(`Notes: ${row.notes}`);
  return parts.join('\n\n');
}

async function main() {
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) {
    throw new Error('LOGIN_EMAIL / LOGIN_PASSWORD missing from .env.import');
  }

  await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  });
  console.log(`Signed in to ${BASE_URL}`);

  const projects = await call('/api/projects');
  const project = projects.find(p => p.name === PROJECT_NAME) || projects[0];
  if (!project) throw new Error('No accessible project found on production');
  console.log(`Target project: ${project.name} (${project.id})`);

  // Load the current real tree so we don't recreate anything that already exists.
  const tree = await call(`/api/portals?projectId=${project.id}`);
  const portalsByName = new Map(tree.map(p => [p.name, p]));

  async function ensurePortal(name) {
    let p = portalsByName.get(name);
    if (!p) {
      p = await call('/api/portals', {
        method: 'POST',
        body: JSON.stringify({ name, projectId: project.id }),
      });
      p.modules = [];
      portalsByName.set(name, p);
      console.log(`  + created Portal "${name}"`);
    }
    return p;
  }

  async function ensureModule(portal, name) {
    portal.modules = portal.modules || [];
    let m = portal.modules.find(m => m.name === name);
    if (!m) {
      m = await call('/api/modules', {
        method: 'POST',
        body: JSON.stringify({ name, portalId: portal.id }),
      });
      m.suites = [];
      portal.modules.push(m);
      console.log(`  + created Module "${name}"`);
    }
    return m;
  }

  async function ensureSuite(mod, name) {
    mod.suites = mod.suites || [];
    let s = mod.suites.find(s => s.name === name);
    if (!s) {
      s = await call('/api/features', {
        method: 'POST',
        body: JSON.stringify({ name, moduleId: mod.id }),
      });
      mod.suites.push(s);
      console.log(`  + created Suite "${name}"`);
    }
    return s;
  }

  const rows = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  console.log(`Loaded ${rows.length} rows`);

  let created = 0;
  let linked = 0;
  let freeText = 0;

  for (const row of rows) {
    const loc = resolveLocation(row);

    let scopeType = 'All';
    let scopeId = null;
    let portalName = loc.portalName;
    let moduleName = loc.moduleName;
    let featureName = loc.featureName;

    if (!loc.forceAll && loc.portalName) {
      const portal = await ensurePortal(loc.portalName);
      portalName = portal.name;
      if (loc.moduleName) {
        const mod = await ensureModule(portal, loc.moduleName);
        moduleName = mod.name;
        if (loc.featureName) {
          const suite = await ensureSuite(mod, loc.featureName);
          featureName = suite.name;
          scopeType = 'Suite';
          scopeId = suite.id;
        } else {
          scopeType = 'Module';
          scopeId = mod.id;
        }
        linked++;
      } else {
        scopeType = 'Portal';
        scopeId = portal.id;
        linked++;
      }
    } else {
      freeText++;
    }

    const date = new Date(`${row.date}T00:00:00`);
    const cycleCategory = row.cycleType && CATEGORIES.has(row.cycleType) ? row.cycleType : null;
    const name =
      row.name || moduleName || featureName || `${row.cycleType || 'Quick log'} — ${row.date}`;

    await call('/api/cycles', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: buildDescription(row),
        mode: 'Manual',
        projectId: project.id,
        scopeType,
        scopeId,
        completedAt: date.toISOString(),
        portalName,
        moduleName,
        featureName,
        environment: row.environment,
        platform: row.platform,
        version: row.version,
        cycleCategory,
        ticketLink: row.ticket,
        issueCount: row.issues,
        criticalCount: row.critical,
        majorCount: row.major,
        minorCount: row.minor,
        doneCount: row.done,
        remainingCount: row.remaining,
      }),
    });
    created++;
  }

  console.log(
    `\nPosted ${created} quick logs to production (${linked} linked to a real Module/Suite, ${freeText} as free text / multi-portal).`,
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
