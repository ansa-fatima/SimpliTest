export type Priority = 'High' | 'Medium' | 'Low';
export type Severity = 'Critical' | 'Major' | 'Minor';
export type TestType = 'Functional' | 'Regression' | 'Smoke' | 'Sanity' | 'UI' | 'API';
export type CaseStatus = 'Active' | 'Draft' | 'Archived';
export type Page =
  | 'login'
  | 'dashboard'
  | 'list'
  | 'view'
  | 'edit'
  | 'create'
  | 'cycles'
  | 'cycle'
  | 'reports'
  | 'members'
  | 'plans'
  | 'platforms'
  | 'settings'
  | 'profile';

export interface UserSummary {
  id: string;
  username: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role?: string;
}

// ─── Test Cycles & Runs ──────────────────────────────────────
export type RunResult = 'NotRun' | 'Passed' | 'Failed' | 'Blocked' | 'Skipped';
export type CycleStatus = 'Active' | 'Completed' | 'Archived';
export type CycleScopeType = 'All' | 'Portal' | 'Module' | 'Suite' | 'Custom';
export type CycleMode = 'CaseBased' | 'Manual';

export interface Project {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  _count?: { portals: number; cycles: number };
}

export interface Portal {
  id: string;
  name: string;
  slug: string | null;
  icon: string | null;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  _count?: { modules: number };
}

export interface CycleSummary {
  total: number;
  done: number;
  percent: number;
  counts: Record<RunResult, number>;
}

export interface TestCycle {
  id: string;
  name: string;
  description: string;
  status: CycleStatus;
  mode?: CycleMode;
  scopeType: CycleScopeType;
  scopeId: string | null;
  scopeName?: string | null;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
  summary?: CycleSummary;

  // Manual-mode bookkeeping (free text; present for all cycles but only meaningful when mode === 'Manual')
  portalName?: string | null;
  moduleName?: string | null;
  featureName?: string | null;
  environment?: string | null;
  platform?: string | null;
  version?: string | null;
  cycleCategory?: string | null;
  ticketLink?: string | null;
  issueCount?: number;
  criticalCount?: number;
  majorCount?: number;
  minorCount?: number;
  doneCount?: number;
  remainingCount?: number;
  passedCount?: number;
  failedCount?: number;
  blockedCount?: number;
}

export interface ApiTestCase {
  id: string;
  caseNum: number;
  title: string;
  sub: string;
  desc: string;
  preconditions: string;
  steps: unknown;
  expected: string;
  priority: Priority;
  severity: Severity;
  type: TestType;
  status: CaseStatus;
  featureId: string;
  suiteId?: string;
  author: string;
  ownerId: string | null;
  owner?: UserSummary | null;
  createdAt: string;
  updatedAt: string;
  suite?: { id: string; name: string; module: { id: string; name: string } };
  feature?: { id: string; name: string; module: { id: string; name: string } };
}

export interface ApiTestRun {
  id: string;
  cycleId: string;
  testCaseId: string;
  result: RunResult;
  notes: string;
  executedAt: string | null;
  executedBy: string;
  createdAt: string;
  updatedAt: string;
  testCase: ApiTestCase;
}

export interface TestCase {
  /** Display ID — formatted as "TC-NN" using the DB's auto-incrementing caseNum. */
  id: string;
  /** DB primary key (cuid) — used for PATCH/DELETE against /api/test-cases/:apiId. Optional for legacy local-only cases. */
  apiId?: string;
  /** Auto-incrementing case number from the DB (renders as TC-{padded}). Optional for legacy local-only cases. */
  caseNum?: number;
  title: string;
  sub: string;
  priority: Priority;
  severity: Severity;
  type: TestType;
  feature: string;
  updated: string;
  desc: string;
  /** Setup steps the tester must complete before running this case. */
  preconditions: string;
  steps: string[];
  expected: string;
  created: string;
  author: string;
  updatedFull: string;
}

export interface Module {
  name: string;
  features: string[];
}

export const MODULES: Module[] = [
  { name: 'Authentication', features: ['Login Flow', 'Password Reset', 'SSO / OAuth'] },
  { name: 'Dashboard', features: ['Widgets', 'Filters'] },
  { name: 'User Management', features: ['Roles', 'Permissions'] },
];

export const MODULE_FEATURES: Record<string, string[]> = {
  Authentication: ['Login Flow', 'Password Reset', 'SSO / OAuth'],
  Dashboard: ['Widgets', 'Filters'],
  'User Management': ['Roles', 'Permissions'],
};
