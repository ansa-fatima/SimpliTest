const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SEED_MODULES = [
  { name: 'Authentication', features: ['Login Flow', 'Password Reset', 'SSO / OAuth'] },
  { name: 'Dashboard', features: ['Widgets', 'Filters'] },
  { name: 'User Management', features: ['Roles', 'Permissions'] },
];

const SEED_CASES = [
  {
    moduleName: 'Authentication',
    featureName: 'Login Flow',
    title: 'Valid email + correct password signs in',
    sub: 'Happy-path login with valid credentials',
    desc: 'Verify the standard sign-in flow with valid user credentials.',
    steps: ['Open /login', 'Enter valid email', 'Enter correct password', 'Click "Sign in"'],
    expected: 'User is redirected to /dashboard within 2 seconds.',
    priority: 'High', severity: 'Critical', type: 'Functional',
  },
  {
    moduleName: 'Authentication',
    featureName: 'Login Flow',
    title: 'Invalid password shows error message',
    sub: 'Negative path — wrong password',
    desc: 'Login attempt with incorrect password should fail gracefully.',
    steps: ['Open /login', 'Enter valid email', 'Enter wrong password', 'Click "Sign in"'],
    expected: 'Inline error "Invalid email or password" appears under the password field.',
    priority: 'High', severity: 'Major', type: 'Functional',
  },
  {
    moduleName: 'Authentication',
    featureName: 'Password Reset',
    title: 'Reset link delivered to registered email',
    sub: 'Email sent within 30s of request',
    desc: 'Confirm that password reset emails are sent and arrive in inbox.',
    steps: ['Click "Forgot password?"', 'Enter registered email', 'Submit form'],
    expected: 'Reset email arrives within 30 seconds containing a single-use link.',
    priority: 'High', severity: 'Critical', type: 'Functional',
  },
  {
    moduleName: 'Dashboard',
    featureName: 'Widgets',
    title: 'KPI widget displays correct totals',
    sub: 'Match values against database query',
    desc: 'Dashboard KPI widgets must reflect underlying data accurately.',
    steps: ['Login as admin', 'Navigate to /dashboard', 'Inspect KPI widgets'],
    expected: 'All KPI values match the corresponding DB query results.',
    priority: 'Medium', severity: 'Major', type: 'Functional',
  },
  {
    moduleName: 'Dashboard',
    featureName: 'Filters',
    title: 'Date range filter restricts widget data',
    sub: 'Last 7 / 30 / 90 days options',
    desc: 'Filtering by date range should update widget contents.',
    steps: ['Open dashboard', 'Choose "Last 7 days"', 'Wait for refresh'],
    expected: 'All widgets refresh and only show data from the last 7 days.',
    priority: 'Medium', severity: 'Minor', type: 'UI',
  },
  {
    moduleName: 'User Management',
    featureName: 'Roles',
    title: 'Admin can assign role to user',
    sub: 'Role dropdown updates persisted',
    desc: 'Admins should be able to change a user\'s role from the user list.',
    steps: ['Login as admin', 'Open Users page', 'Pick a user', 'Change role to "Editor"', 'Save'],
    expected: 'User role updates and persists across page reload.',
    priority: 'High', severity: 'Major', type: 'Functional',
  },
];

async function main() {
  for (const mod of SEED_MODULES) {
    await prisma.module.upsert({
      where: { name: mod.name },
      update: {},
      create: {
        name: mod.name,
        features: { create: mod.features.map(f => ({ name: f })) },
      },
    });
  }
  console.log(`Seeded ${SEED_MODULES.length} modules`);

  // Seed test cases (idempotent: only insert if no test case with same title exists)
  let created = 0;
  for (const tc of SEED_CASES) {
    const feature = await prisma.feature.findFirst({
      where: { name: tc.featureName, module: { name: tc.moduleName } },
    });
    if (!feature) continue;
    const exists = await prisma.testCase.findFirst({
      where: { featureId: feature.id, title: tc.title },
    });
    if (exists) continue;
    await prisma.testCase.create({
      data: {
        title: tc.title,
        sub: tc.sub,
        desc: tc.desc,
        steps: tc.steps,
        expected: tc.expected,
        priority: tc.priority,
        severity: tc.severity,
        type: tc.type,
        author: 'Seed',
        featureId: feature.id,
      },
    });
    created++;
  }
  console.log(`Seeded ${created} test cases`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
