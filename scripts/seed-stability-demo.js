/* eslint-disable */
// Adds synthetic historical test-run data (8 weekly CaseBased cycles + a few
// Manual quick logs) across 4 existing groups in the "SimpliEd System"
// project, so the Stability report has real trends to show:
//   - Parent Portal / Home        → stable, flat
//   - Student portal / Home       → declining (trend down)
//   - Admin Portal / Academics    → unstable, improving (trend up)
//   - QR Attendance app / Login   → stable, near-perfect
//
// All synthetic cycles are named "[Demo] ..." so they're easy to find and
// bulk-delete later with scripts/cleanup-stability-demo.js.
//
//   node scripts/seed-stability-demo.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_ID = 'cmpgke85c0000bvz81wi7j6e5'; // SimpliEd System
const WEEKS = 8;
const DAY = 24 * 60 * 60 * 1000;
const TESTERS = ['Ansa', 'Smoke Test'];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const GROUPS = [
  {
    label: 'Parent Portal / Home',
    scopeType: 'Suite',
    suiteId: 'cmpgkec0s0009bvz8h4qbh1ha',
    passRates: [93, 95, 92, 96, 94, 95, 97, 95],
  },
  {
    label: 'Student portal / Home',
    scopeType: 'Suite',
    suiteId: 'cmpwdp8fi001vbvuoxgm9zz1l',
    passRates: [95, 92, 88, 82, 78, 74, 68, 65],
  },
  {
    label: 'Admin Portal / Academics',
    scopeType: 'Module',
    moduleId: 'cmqhyk0xq0005bvasbrlukwfz',
    passRates: [42, 48, 55, 60, 65, 70, 75, 80],
  },
  {
    label: 'QR Attendance app / Login',
    scopeType: 'Module',
    moduleId: 'cmqhzdpsy0043bvasx5eox5n3',
    passRates: [98, 97, 100, 96, 98, 99, 97, 100],
  },
];

async function main() {
  let totalCycles = 0;
  let totalRuns = 0;
  let totalLogs = 0;

  for (const g of GROUPS) {
    // Resolve names + the case set for this group.
    let portalName, moduleName, featureName, cases;
    if (g.scopeType === 'Suite') {
      const suite = await prisma.suite.findUnique({
        where: { id: g.suiteId },
        include: { module: { include: { portal: true } } },
      });
      portalName = suite.module.portal.name;
      moduleName = suite.module.name;
      featureName = suite.name;
      cases = await prisma.testCase.findMany({ where: { suiteId: g.suiteId }, select: { id: true } });
    } else {
      const mod = await prisma.module.findUnique({ where: { id: g.moduleId }, include: { portal: true } });
      portalName = mod.portal.name;
      moduleName = mod.name;
      featureName = null;
      cases = await prisma.testCase.findMany({ where: { moduleId: g.moduleId }, select: { id: true } });
    }

    for (let i = 0; i < WEEKS; i++) {
      const date = new Date(Date.now() - (WEEKS - 1 - i) * 7 * DAY);
      const rate = g.passRates[i] / 100;

      // Weekly CaseBased regression cycle
      const cycle = await prisma.testCycle.create({
        data: {
          name: `[Demo] ${g.label} — Wk${i + 1}`,
          mode: 'CaseBased',
          status: 'Completed',
          scopeType: g.scopeType,
          scopeId: g.scopeType === 'Suite' ? g.suiteId : g.moduleId,
          projectId: PROJECT_ID,
          completedAt: date,
          createdAt: date,
        },
      });
      totalCycles++;

      await prisma.testRun.createMany({
        data: cases.map(c => {
          const pass = Math.random() < rate;
          return {
            cycleId: cycle.id,
            testCaseId: c.id,
            result: pass ? 'Passed' : 'Failed',
            executedAt: date,
            executedBy: pick(TESTERS),
            notes: pass ? '' : 'Demo data — synthetic failure',
          };
        }),
      });
      totalRuns += cases.length;

      // Manual quick log every 3rd week, tracking the same trend
      if (i % 3 === 0) {
        const tested = 10;
        const failed = Math.round(tested * (1 - rate));
        const passed = tested - failed;
        const critical = Math.round(failed * 0.2);
        const major = Math.round(failed * 0.5);
        const minor = failed - critical - major;

        await prisma.testCycle.create({
          data: {
            name: `[Demo] ${g.label} quick log — Wk${i + 1}`,
            mode: 'Manual',
            status: 'Completed',
            scopeType: g.scopeType,
            scopeId: g.scopeType === 'Suite' ? g.suiteId : g.moduleId,
            projectId: PROJECT_ID,
            completedAt: date,
            createdAt: date,
            portalName,
            moduleName,
            featureName,
            environment: 'QA',
            platform: 'All',
            cycleCategory: 'Regression',
            issueCount: failed,
            criticalCount: critical,
            majorCount: major,
            minorCount: minor,
            doneCount: failed,
            remainingCount: 0,
            passedCount: passed,
            failedCount: failed,
          },
        });
        totalLogs++;
      }
    }
  }

  console.log(`Created ${totalCycles} demo cycles, ${totalRuns} test runs, ${totalLogs} quick logs.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
