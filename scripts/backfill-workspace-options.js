/* eslint-disable */
// One-off backfill: materializes the 5 built-in roles and the built-in
// Priority/Severity/TestType/RunResult config options as real, deletable
// rows for every EXISTING project (new projects get this from
// lib/seedWorkspaceDefaults.ts at creation time). Safe to re-run --
// skipDuplicates means an already-seeded project is a no-op.
//
//   node scripts/backfill-workspace-options.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BUILTIN_ROLE_LABEL = {
  SuperAdmin: 'Super Admin',
  QAManager: 'QA Manager',
  Tester: 'Tester',
  Developer: 'Developer',
  Viewer: 'Viewer',
};
const BUILTIN_ROLE_COLOR = {
  SuperAdmin: 'red',
  QAManager: 'indigo',
  Tester: 'emerald',
  Developer: 'amber',
  Viewer: 'slate',
};

const BUILTIN_PRIORITY_COLOR = { High: 'red', Medium: 'amber', Low: 'emerald' };
const BUILTIN_SEVERITY_COLOR = { Critical: 'red', Major: 'amber', Minor: 'emerald' };
const BUILTIN_TYPE_COLOR = {
  Functional: 'indigo',
  Regression: 'blue',
  Smoke: 'amber',
  Sanity: 'emerald',
  UI: 'pink',
  API: 'teal',
};
const BUILTIN_RESULT_COLOR = {
  Passed: 'emerald',
  Failed: 'red',
  Blocked: 'amber',
  Skipped: 'slate',
  NotRun: 'slate',
};
const LEGACY_RESULT_CLASS = {
  Passed: 'PassLike',
  Failed: 'FailLike',
  Blocked: 'FailLike',
  NotRun: 'Neutral',
  Skipped: 'Neutral',
};

async function main() {
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  console.log(`Backfilling ${projects.length} project(s)...`);

  for (const project of projects) {
    const roles = await prisma.workspaceRole.createMany({
      data: Object.keys(BUILTIN_ROLE_LABEL).map(r => ({
        projectId: project.id,
        name: BUILTIN_ROLE_LABEL[r],
        color: BUILTIN_ROLE_COLOR[r],
        isBuiltin: true,
        builtinRole: r,
      })),
      skipDuplicates: true,
    });

    const optionRows = [
      ...Object.entries(BUILTIN_PRIORITY_COLOR).map(([name, color]) => ({
        category: 'Priority',
        name,
        color,
      })),
      ...Object.entries(BUILTIN_SEVERITY_COLOR).map(([name, color]) => ({
        category: 'Severity',
        name,
        color,
      })),
      ...Object.entries(BUILTIN_TYPE_COLOR).map(([name, color]) => ({
        category: 'TestType',
        name,
        color,
      })),
      ...Object.entries(BUILTIN_RESULT_COLOR).map(([name, color]) => ({
        category: 'RunResult',
        name,
        color,
        countsAs: LEGACY_RESULT_CLASS[name],
      })),
    ];
    const options = await prisma.workspaceOption.createMany({
      data: optionRows.map(o => ({
        projectId: project.id,
        category: o.category,
        name: o.name,
        color: o.color,
        isBuiltin: true,
        countsAs: o.countsAs ?? null,
      })),
      skipDuplicates: true,
    });

    console.log(`  ${project.name}: +${roles.count} role(s), +${options.count} option(s)`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
