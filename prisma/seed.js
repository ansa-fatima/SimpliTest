/* eslint-disable */
// Idempotent seed for Simplitest demo data.
//   npm run db:seed
//
// Hierarchy: Project (platform) → Portal (app/product) → Module (folder) → Suite → TestCase
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// 1. Default project ──────────────────────────────────────────
const PROJECT = { name: 'Default', slug: 'default' };

// 2. Portals + their module/suite tree
//    Each portal models one app/product inside the platform (Admin / Teacher / Parent / Student).
const SEED_PORTALS = [
  {
    name: 'Admin Web',
    slug: 'admin-web',
    icon: 'ti-shield-lock',
    modules: [
      { module: 'Authentication', suites: ['Login Flow', 'Password Reset', 'SSO / OAuth'] },
      { module: 'User Management', suites: ['Roles', 'Permissions'] },
      { module: 'Dashboard', suites: ['Widgets', 'Filters'] },
    ],
  },
  {
    name: 'Teacher Web',
    slug: 'teacher-web',
    icon: 'ti-school',
    modules: [
      { module: 'Attendance', suites: ['QR Attendance', 'Manual Entry', 'Reports'] },
      { module: 'Gradebook', suites: ['Enter Marks', 'Publish Results'] },
    ],
  },
  {
    name: 'Parent Mobile',
    slug: 'parent-mobile',
    icon: 'ti-device-mobile',
    modules: [
      { module: 'Notifications', suites: ['Push', 'Email Digest'] },
      { module: 'Fee Payments', suites: ['Card', 'Bank Transfer'] },
    ],
  },
  {
    name: 'Student Mobile',
    slug: 'student-mobile',
    icon: 'ti-user',
    modules: [
      { module: 'Timetable', suites: ['Today View', 'Week View'] },
      { module: 'Assignments', suites: ['Submit', 'View Feedback'] },
    ],
  },
];

// 3. Test cases — covering several portals so the demo shows a real cross-portal tree.
const SEED_CASES = [
  // ── Admin Web / Authentication / Login Flow ──
  {
    portal: 'Admin Web',
    module: 'Authentication',
    suite: 'Login Flow',
    title: 'Valid email + correct password signs in',
    sub: 'Happy-path login with valid credentials',
    desc: 'Verify the standard sign-in flow with valid user credentials.',
    steps: ['Open /login', 'Enter valid email', 'Enter correct password', 'Click "Sign in"'],
    expected: 'User is redirected to /dashboard within 2 seconds.',
    priority: 'High',
    severity: 'Critical',
    type: 'Functional',
  },
  {
    portal: 'Admin Web',
    module: 'Authentication',
    suite: 'Login Flow',
    title: 'Invalid password shows error message',
    sub: 'Negative path — wrong password',
    desc: 'Login attempt with incorrect password should fail gracefully.',
    steps: ['Open /login', 'Enter valid email', 'Enter wrong password', 'Click "Sign in"'],
    expected: 'Inline error "Invalid email or password" appears under the password field.',
    priority: 'High',
    severity: 'Major',
    type: 'Functional',
  },
  {
    portal: 'Admin Web',
    module: 'Authentication',
    suite: 'Login Flow',
    title: 'Account locks after 5 failed attempts',
    sub: 'Brute-force protection',
    desc: 'After 5 consecutive wrong passwords the account is locked for 15 minutes.',
    steps: ['Submit wrong password 5 times', 'Attempt 6th sign-in'],
    expected: 'Lockout banner appears; 6th attempt is rejected even with the right password.',
    priority: 'High',
    severity: 'Critical',
    type: 'Smoke',
  },
  {
    portal: 'Admin Web',
    module: 'Authentication',
    suite: 'Password Reset',
    title: 'Reset link delivered to registered email',
    sub: 'Email sent within 30s',
    desc: 'Confirm password reset emails are sent and arrive in inbox.',
    steps: ['Click "Forgot password?"', 'Enter registered email', 'Submit form'],
    expected: 'Reset email arrives within 30 seconds containing a single-use link.',
    priority: 'High',
    severity: 'Critical',
    type: 'Functional',
  },
  {
    portal: 'Admin Web',
    module: 'Authentication',
    suite: 'SSO / OAuth',
    title: 'Sign in with Google',
    sub: 'OAuth round trip',
    desc: 'Google OAuth flow completes and creates/links a user account.',
    steps: ['Click "Continue with Google"', 'Pick test account', 'Approve consent'],
    expected: 'User is signed in; new account created if email unseen before.',
    priority: 'High',
    severity: 'Major',
    type: 'Functional',
  },
  // ── Admin Web / User Management ──
  {
    portal: 'Admin Web',
    module: 'User Management',
    suite: 'Roles',
    title: 'Admin can change a user role',
    sub: 'Role dropdown updates persisted',
    desc: "Admins can change a user's role from the Users page.",
    steps: ['Open Users page', 'Pick a user', 'Change role to Editor', 'Save'],
    expected: 'Role updates and persists across page reload.',
    priority: 'High',
    severity: 'Major',
    type: 'Functional',
  },
  {
    portal: 'Admin Web',
    module: 'User Management',
    suite: 'Permissions',
    title: 'Viewer cannot delete test cases',
    sub: 'RBAC enforcement',
    desc: 'Viewer-role users must not see destructive actions.',
    steps: ['Sign in as viewer', 'Open a test case', 'Inspect actions'],
    expected: 'No Delete or Edit buttons are visible; API rejects DELETE with 403.',
    priority: 'High',
    severity: 'Critical',
    type: 'API',
  },
  // ── Admin Web / Dashboard ──
  {
    portal: 'Admin Web',
    module: 'Dashboard',
    suite: 'Widgets',
    title: 'KPI widget shows correct total cases',
    sub: 'Match against DB query',
    desc: 'Dashboard KPI must reflect underlying data accurately.',
    steps: ['Login as admin', 'Navigate to /dashboard', 'Inspect "Total cases" KPI'],
    expected: 'Value equals `select count(*) from test_cases` for the project.',
    priority: 'Medium',
    severity: 'Major',
    type: 'Functional',
  },
  // ── Teacher Web / Attendance ──
  {
    portal: 'Teacher Web',
    module: 'Attendance',
    suite: 'QR Attendance',
    title: 'Scan valid student QR at entry gate',
    sub: 'Standard happy path',
    desc: 'Verify a freshly issued QR is recognised and student marked present.',
    steps: [
      'Open Attendance → QR Scan',
      'Grant camera permission',
      'Point camera at valid QR',
      'Tap "Confirm attendance"',
    ],
    expected: 'Student marked present with current timestamp; parent receives push within 5s.',
    priority: 'High',
    severity: 'Critical',
    type: 'Functional',
  },
  {
    portal: 'Teacher Web',
    module: 'Attendance',
    suite: 'QR Attendance',
    title: 'Offline scan syncs when network returns',
    sub: 'Captures locally first',
    desc: 'Scans made offline should be queued and synced on reconnect.',
    steps: ['Enable airplane mode', 'Scan 3 QRs', 'Disable airplane mode'],
    expected: '3 attendance records appear server-side within 10 seconds of reconnect.',
    priority: 'High',
    severity: 'Critical',
    type: 'Regression',
  },
  {
    portal: 'Teacher Web',
    module: 'Attendance',
    suite: 'Manual Entry',
    title: 'Teacher marks bulk attendance for a class',
    sub: 'Single-click "All present"',
    desc: 'Teacher can mark an entire class present in one tap.',
    steps: ['Open class roster', 'Tap "Mark all present"', 'Confirm dialog'],
    expected: 'All 35 students show as Present; record reflects in admin portal.',
    priority: 'High',
    severity: 'Major',
    type: 'Functional',
  },
  // ── Parent Mobile / Notifications ──
  {
    portal: 'Parent Mobile',
    module: 'Notifications',
    suite: 'Push',
    title: 'Push notification on absence',
    sub: 'Real-time delivery',
    desc: 'Parent gets an immediate push when their child is marked absent.',
    steps: ['Mark student absent', 'Wait 60s'],
    expected: 'Push received on parent device with the student name.',
    priority: 'Medium',
    severity: 'Major',
    type: 'Functional',
  },
];

async function main() {
  // 1) Default project
  const project = await prisma.project.upsert({
    where: { slug: PROJECT.slug },
    update: {},
    create: { name: PROJECT.name, slug: PROJECT.slug },
  });
  console.log(`Project: ${project.name} (${project.id})`);

  // 2) Portals + modules + suites (idempotent via composite uniques)
  let portalCount = 0;
  let moduleCount = 0;
  let suiteCount = 0;
  for (const p of SEED_PORTALS) {
    const portal = await prisma.portal.upsert({
      where: { projectId_name: { projectId: project.id, name: p.name } },
      update: { slug: p.slug, icon: p.icon },
      create: { name: p.name, slug: p.slug, icon: p.icon, projectId: project.id },
    });
    portalCount++;

    for (const m of p.modules) {
      const mod = await prisma.module.upsert({
        where: { portalId_name: { portalId: portal.id, name: m.module } },
        update: {},
        create: { name: m.module, portalId: portal.id },
      });
      moduleCount++;
      for (const suiteName of m.suites) {
        await prisma.suite.upsert({
          where: { moduleId_name: { moduleId: mod.id, name: suiteName } },
          update: {},
          create: { name: suiteName, moduleId: mod.id },
        });
        suiteCount++;
      }
    }
  }
  console.log(`Seeded ${portalCount} portals, ${moduleCount} modules, ${suiteCount} suites`);

  // 3) Test cases — idempotent on (suiteId, title)
  let created = 0;
  for (const tc of SEED_CASES) {
    const suite = await prisma.suite.findFirst({
      where: {
        name: tc.suite,
        module: {
          name: tc.module,
          portal: { name: tc.portal, projectId: project.id },
        },
      },
    });
    if (!suite) continue;
    const exists = await prisma.testCase.findFirst({
      where: { suiteId: suite.id, title: tc.title },
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
        suiteId: suite.id,
      },
    });
    created++;
  }
  console.log(`Seeded ${created} new test cases (already-existing ones skipped)`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
