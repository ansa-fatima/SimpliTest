// One-time cleanup after the workspace revert.
// 1. Drop duplicate modules (keep the one with the most features, or the oldest)
// 2. Drop orphaned workspaces table + columns via subsequent `prisma db push`.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Use raw SQL since Prisma doesn't know about workspaceId anymore but the
  // column still exists in the live DB. We need to deduplicate before pushing.
  const rows = await prisma.$queryRaw`
    SELECT id, name FROM modules ORDER BY "createdAt" ASC
  `;

  // Group by name; keep the FIRST id, delete the rest.
  const seen = new Set();
  const toDelete = [];
  for (const r of rows) {
    if (seen.has(r.name)) toDelete.push(r.id);
    else seen.add(r.name);
  }

  if (toDelete.length === 0) {
    console.log('No duplicate modules to delete.');
  } else {
    console.log(`Deleting ${toDelete.length} duplicate module(s):`, toDelete);
    // Cascade will drop their features and any test cases inside them.
    await prisma.module.deleteMany({ where: { id: { in: toDelete } } });
  }

  // Also drop orphan TestCycle rows whose workspace no longer exists?
  // Cycles don't reference workspace via FK in the new schema (we dropped it),
  // so they're fine — they just have a stray workspaceId column.

  console.log('Done. Now run: npx prisma db push --accept-data-loss');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
