/* eslint-disable */
// Imports the "Testing Cycles" xlsx export into the LOCAL dev database as
// Manual quick-log cycles, creating any missing Module/Suite ("feature
// folder") in the real Portal > Module > Suite tree so each log is properly
// linked (shows in the quick-log location picker, feeds the Stability report)
// instead of landing as free text.
//
// Mapping from the sheet's PORTAL/MODULE/FEATURE columns to the real tree:
//   - PORTAL "Admin Portal"    -> real Portal "Admin Portal"
//                                 sheet MODULE  -> real Module (created if missing)
//                                 sheet FEATURE -> real Suite  (created if missing)
//   - PORTAL "Parent Portal"   -> "Parent Portal" is already a real MODULE
//                                 (under Portal "SimpliEd - Mobile App"), not
//                                 a portal, so: real Portal = SimpliEd - Mobile App,
//                                 real Module = Parent Portal (existing),
//                                 real Suite  = sheet MODULE (e.g. "Mobile App",
//                                 "Home") — created if missing. The sheet's own
//                                 FEATURE text for these rows is one-off ticket
//                                 detail, not a reusable folder name, so it's
//                                 kept in the cycle name/description instead of
//                                 creating a 4th tree level for it.
//   - PORTAL "Teacher Portal"  -> genuinely new; created as a new top-level
//                                 Portal "Teacher App" (matching the naming
//                                 style of the existing "QR Attendance app"),
//                                 sheet MODULE -> real Module (created),
//                                 sheet FEATURE -> real Suite (created if missing).
//   - PORTAL "Multi-Portal (...)" -> spans more than one portal, which the data
//                                 model has no way to express as a single
//                                 scope. Logged as scopeType 'All' (workspace-
//                                 wide) with the sheet's module/feature kept as
//                                 free text, same as the rest of this quick log.
//
//   node scripts/import-testing-cycles-xlsx.js

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_ID = 'cmpgke85c0000bvz81wi7j6e5'; // SimpliEd System
const DATA_PATH =
  'C:/Users/ansaf/AppData/Local/Temp/claude/C--Users-ansaf-Desktop-SmpliTest/249c0ad0-2cdd-4f14-8783-8ebfd1b6e402/scratchpad/testing_cycles.json';

// Known near-duplicate naming from the source sheet vs. the real tree.
const MODULE_ALIAS = { Academic: 'Academics' };

const CATEGORIES = new Set(['Stability', 'Regression', 'UI', 'Functional', 'Performance']);

function resolveLocation(row) {
  if (row.portal === 'Admin Portal') {
    return {
      portalName: 'Admin Portal',
      moduleName: row.module ? (MODULE_ALIAS[row.module] ?? row.module) : null,
      featureName: row.feature ?? null,
      scopeType: 'All',
    };
  }
  if (row.portal === 'Parent Portal') {
    return {
      portalName: 'SimpliEd - Mobile App',
      moduleName: 'Parent Portal',
      featureName: row.module ?? null,
      scopeType: 'All',
    };
  }
  if (row.portal === 'Teacher Portal') {
    return {
      portalName: 'Teacher App',
      moduleName: row.module ?? 'Teacher App',
      featureName: row.feature ?? null,
      scopeType: 'All',
    };
  }
  // "Multi-Portal (...)" or anything unrecognized — no single real location.
  return {
    portalName: null,
    moduleName: row.module ?? null,
    featureName: row.feature ?? null,
    scopeType: 'All',
    forceAll: true,
  };
}

async function ensurePortal(name) {
  let portal = await prisma.portal.findFirst({ where: { projectId: PROJECT_ID, name } });
  if (!portal) {
    portal = await prisma.portal.create({
      data: { name, projectId: PROJECT_ID, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') },
    });
    console.log(`  + created Portal "${name}"`);
  }
  return portal;
}

async function ensureModule(portalId, name) {
  let mod = await prisma.module.findFirst({ where: { portalId, name } });
  if (!mod) {
    mod = await prisma.module.create({ data: { name, portalId } });
    console.log(`  + created Module "${name}"`);
  }
  return mod;
}

async function ensureSuite(moduleId, name) {
  let suite = await prisma.suite.findFirst({ where: { moduleId, parentId: null, name } });
  if (!suite) {
    suite = await prisma.suite.create({ data: { name, moduleId } });
    console.log(`  + created Suite "${name}"`);
  }
  return suite;
}

function buildDescription(row) {
  const parts = [];
  if (row.description) parts.push(row.description);
  if (row.feedback) parts.push(`Feedback: ${row.feedback}`);
  if (row.notes) parts.push(`Notes: ${row.notes}`);
  return parts.join('\n\n');
}

async function main() {
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
        const mod = await ensureModule(portal.id, loc.moduleName);
        moduleName = mod.name;
        if (loc.featureName) {
          const suite = await ensureSuite(mod.id, loc.featureName);
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

    await prisma.testCycle.create({
      data: {
        name,
        description: buildDescription(row),
        status: 'Completed',
        mode: 'Manual',
        scopeType,
        scopeId,
        projectId: PROJECT_ID,
        completedAt: date,
        createdAt: date,
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
      },
    });
    created++;
  }

  console.log(
    `\nImported ${created} quick logs (${linked} linked to a real Module/Suite, ${freeText} as free text / multi-portal).`,
  );
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
