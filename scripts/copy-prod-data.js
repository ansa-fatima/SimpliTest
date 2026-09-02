/* eslint-disable */
// Read-only copy of real production content into the LOCAL dev database, so
// the UI can be tested against real data without touching production.
//
//   - Reads ONLY (GET requests) from the production API, plus the one login
//     POST needed to establish a session — never creates, updates, or
//     deletes anything on production.
//   - Writes into whatever DATABASE_URL is in .env (the local dev DB).
//   - Lands everything in a brand-new local project ("<name> (Prod copy)")
//     so nothing existing locally is touched or overwritten.
//   - Copies: portals, modules, suites, test cases, test cycles, test runs.
//   - Deliberately does NOT copy: users, sessions, memberships, invites,
//     password hashes, or reset tokens — no real accounts or credentials
//     land in the local copy. `executedBy` is copied as-is since it's just
//     a free-text display string on TestRun, not an account reference.
//
//   node scripts/copy-prod-data.js

require('dotenv').config({ path: '.env.import' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = 'https://simplitest.srv3.simpliedtech.com';
const { LOGIN_EMAIL, LOGIN_PASSWORD, PROJECT_NAME } = process.env;

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
    throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function createWithFallback(model, oldId, data, idMap) {
  try {
    const row = await prisma[model].create({ data: { ...data, id: oldId } });
    idMap.set(oldId, row.id);
    return row;
  } catch (e) {
    if (e.code === 'P2002') {
      const row = await prisma[model].create({ data });
      idMap.set(oldId, row.id);
      return row;
    }
    throw e;
  }
}

async function main() {
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) {
    throw new Error('LOGIN_EMAIL / LOGIN_PASSWORD missing from .env.import');
  }

  await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  });
  console.log(`Signed in to ${BASE_URL} (read-only session).`);

  const projects = await call('/api/projects');
  const project = projects.find(p => p.name === PROJECT_NAME) || projects[0];
  if (!project) throw new Error('No accessible project found on production');
  console.log(`Source project: ${project.name} (${project.id})`);

  const portals = await call(`/api/portals?projectId=${project.id}`);
  console.log(`Fetched ${portals.length} portals`);

  let allCases = [];
  let page = 1;
  while (true) {
    const res = await call(
      `/api/test-cases?projectId=${project.id}&page=${page}&pageSize=200&sort=caseNum&order=asc`,
    );
    allCases.push(...res.items);
    if (page >= res.totalPages) break;
    page++;
  }
  console.log(`Fetched ${allCases.length} test cases`);

  const cycles = await call(`/api/cycles?projectId=${project.id}`);
  console.log(`Fetched ${cycles.length} cycles`);

  const runsByCycle = new Map();
  for (const c of cycles) {
    if (c.mode !== 'CaseBased') continue;
    const runs = await call(`/api/cycles/${c.id}/runs`);
    runsByCycle.set(c.id, runs);
  }
  const totalRuns = [...runsByCycle.values()].reduce((n, r) => n + r.length, 0);
  console.log(`Fetched ${totalRuns} test runs across ${runsByCycle.size} case-based cycles`);

  // ---- Write into the LOCAL dev database ----
  const localProject = await prisma.project.create({
    data: {
      name: `${project.name} (Prod copy)`,
      slug: `${project.slug}-prod-copy-${Date.now()}`,
    },
  });
  console.log(`Created local project: ${localProject.name} (${localProject.id})`);

  const idMap = new Map();

  for (const p of portals) {
    await createWithFallback(
      'portal',
      p.id,
      { name: p.name, slug: p.slug, icon: p.icon, projectId: localProject.id },
      idMap,
    );
    for (const m of p.modules) {
      await createWithFallback('module', m.id, { name: m.name, portalId: idMap.get(p.id) }, idMap);
      const createSuiteTree = async (suites, parentOldId) => {
        for (const s of suites) {
          await createWithFallback(
            'suite',
            s.id,
            {
              name: s.name,
              moduleId: idMap.get(m.id),
              parentId: parentOldId ? idMap.get(parentOldId) : null,
            },
            idMap,
          );
          if (s.children?.length) await createSuiteTree(s.children, s.id);
        }
      };
      await createSuiteTree(m.suites, null);
    }
  }
  console.log('Copied portal/module/suite tree');

  for (const tc of allCases) {
    await createWithFallback(
      'testCase',
      tc.id,
      {
        title: tc.title,
        sub: tc.sub,
        desc: tc.desc,
        preconditions: tc.preconditions,
        steps: tc.steps,
        expected: tc.expected,
        priority: tc.priority,
        severity: tc.severity,
        type: tc.type,
        status: tc.status,
        author: tc.author,
        portalId: tc.portalId ? idMap.get(tc.portalId) : null,
        moduleId: tc.moduleId ? idMap.get(tc.moduleId) : null,
        suiteId: tc.suiteId ? idMap.get(tc.suiteId) : null,
      },
      idMap,
    );
  }
  console.log(`Copied ${allCases.length} test cases`);

  let cycleCount = 0;
  let runCount = 0;
  for (const c of cycles) {
    await createWithFallback(
      'testCycle',
      c.id,
      {
        name: c.name,
        description: c.description,
        status: c.status,
        mode: c.mode,
        scopeType: c.scopeType,
        scopeId: c.scopeId ? (idMap.get(c.scopeId) ?? c.scopeId) : null,
        targetDate: c.targetDate,
        completedAt: c.completedAt,
        projectId: localProject.id,
        portalName: c.portalName,
        moduleName: c.moduleName,
        featureName: c.featureName,
        environment: c.environment,
        platform: c.platform,
        version: c.version,
        cycleCategory: c.cycleCategory,
        ticketLink: c.ticketLink,
        issueCount: c.issueCount,
        criticalCount: c.criticalCount,
        majorCount: c.majorCount,
        minorCount: c.minorCount,
        doneCount: c.doneCount,
        remainingCount: c.remainingCount,
        passedCount: c.passedCount,
        failedCount: c.failedCount,
        blockedCount: c.blockedCount,
      },
      idMap,
    );
    cycleCount++;

    const runs = runsByCycle.get(c.id) || [];
    for (const r of runs) {
      if (!idMap.has(r.testCaseId)) continue;
      await createWithFallback(
        'testRun',
        r.id,
        {
          cycleId: idMap.get(c.id),
          testCaseId: idMap.get(r.testCaseId),
          result: r.result,
          notes: r.notes,
          executedAt: r.executedAt,
          executedBy: r.executedBy,
        },
        idMap,
      );
      runCount++;
    }
  }
  console.log(`Copied ${cycleCount} cycles and ${runCount} test runs`);
  console.log(`\nDone — local project "${localProject.name}" (${localProject.id}) is ready.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
