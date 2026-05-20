/* eslint-disable */
// Destructive: drops the `public` schema and recreates it empty.
// After this runs the caller is expected to apply migrations and seed.
//
// Used by:
//   - `npm run db:reset`                      (manual local reset)
//   - Dockerfile startup when SEED_DATA=true  (one-shot prod reset)
//
// Why DROP SCHEMA instead of `prisma migrate reset`?
//   This survives a corrupted `_prisma_migrations` table or orphaned enum types
//   that block `migrate deploy` / `db push` — exactly the state the live DB
//   was in when "type public.UserRole does not exist" started firing.
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('reset: dropping public schema...');
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA public');
    console.log('reset: public schema recreated empty.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error('reset failed:', e);
  process.exit(1);
});
