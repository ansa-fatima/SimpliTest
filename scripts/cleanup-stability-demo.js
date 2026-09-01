/* eslint-disable */
// Removes every cycle (and its test runs, via cascade) created by
// scripts/seed-stability-demo.js — anything named "[Demo] ...".
//
//   node scripts/cleanup-stability-demo.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const { count } = await prisma.testCycle.deleteMany({
    where: { name: { startsWith: '[Demo] ' } },
  });
  console.log(`Deleted ${count} demo cycles (their test runs cascade-deleted with them).`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
