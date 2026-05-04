export type Priority = 'High' | 'Medium' | 'Low';
export type Severity = 'Critical' | 'Major' | 'Minor';
export type TestType = 'Functional' | 'Regression' | 'Smoke' | 'Sanity' | 'UI' | 'API';
export type Page = 'login' | 'dashboard' | 'list' | 'view' | 'edit' | 'create' | 'cycles' | 'cycle';

// ─── Test Cycles & Runs ──────────────────────────────────────
export type RunResult = 'NotRun' | 'Passed' | 'Failed' | 'Blocked' | 'Skipped';
export type CycleStatus = 'Active' | 'Completed' | 'Archived';
export type CycleScopeType = 'All' | 'Module' | 'Feature' | 'Custom';

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
  scopeType: CycleScopeType;
  scopeId: string | null;
  scopeName?: string | null;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
  summary?: CycleSummary;
}

export interface ApiTestCase {
  id: string;
  caseNum: number;
  title: string;
  sub: string;
  desc: string;
  steps: unknown;
  expected: string;
  priority: Priority;
  severity: Severity;
  type: TestType;
  featureId: string;
  author: string;
  createdAt: string;
  updatedAt: string;
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
  id: string;
  title: string;
  sub: string;
  priority: Priority;
  severity: Severity;
  type: TestType;
  feature: string;
  updated: string;
  desc: string;
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
