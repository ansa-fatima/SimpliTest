/* eslint-disable */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({ select: { id: true, name: true, slug: true } });
  console.log('PROJECTS:', JSON.stringify(projects));

  for (const p of projects) {
    const portals = await prisma.portal.findMany({
      where: { projectId: p.id },
      include: {
        modules: { include: { suites: { include: { _count: { select: { testCases: true } } } } } },
      },
    });
    console.log(`\n=== Project ${p.name} (${p.id}) ===`);
    for (const portal of portals) {
      console.log(`Portal: ${portal.name} (${portal.id})`);
      for (const mod of portal.modules) {
        console.log(`  Module: ${mod.name} (${mod.id})`);
        for (const s of mod.suites) {
          console.log(`    Suite: ${s.name} (${s.id}) — ${s._count.testCases} cases`);
        }
      }
    }
    const cycleCount = await prisma.testCycle.count({ where: { projectId: p.id } });
    const runCount = await prisma.testRun.count({ where: { cycle: { projectId: p.id } } });
    const caseCount = await prisma.testCase.count({
      where: {
        OR: [
          { portal: { projectId: p.id } },
          { module: { portal: { projectId: p.id } } },
          { suite: { module: { portal: { projectId: p.id } } } },
        ],
      },
    });
    console.log(`Cycles: ${cycleCount}, Runs: ${runCount}, TestCases: ${caseCount}`);

    // Breakdown by exact attachment level
    const directPortal = await prisma.testCase.groupBy({
      by: ['portalId'],
      where: { portal: { projectId: p.id }, moduleId: null, suiteId: null },
      _count: true,
    });
    const directModule = await prisma.testCase.groupBy({
      by: ['moduleId'],
      where: { module: { portal: { projectId: p.id } }, suiteId: null },
      _count: true,
    });
    const bySuite = await prisma.testCase.groupBy({
      by: ['suiteId'],
      where: { suite: { module: { portal: { projectId: p.id } } } },
      _count: true,
    });
    console.log('Direct-on-portal:', JSON.stringify(directPortal));
    console.log('Direct-on-module:', JSON.stringify(directModule));
    console.log('By-suite:', JSON.stringify(bySuite));
  }
}

main().finally(() => prisma.$disconnect());
