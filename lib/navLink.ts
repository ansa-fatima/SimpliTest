// Every screen has an address: the app is one page, so a screen is named by the query
// string (`/?view=runs`, `/?plan=<id>`, `/?cycle=<id>`, ...). The address bar follows
// the open screen, and opening such a link goes straight to it.
//
//   view=cases|runs|quicklogs|plans|reports|team|roles|settings|profile|todo|projects
//   case=<number>     a test case            folder=s:<id>  a repository folder
//   cycle=<id>        a run (execution)       overview=<id>  a run's summary
//   plan=<id>         a test plan             tab=stability|cycleHistory (with view=reports)
import type { Page } from '@/types';

export const VIEWS = [
  'cases',
  'runs',
  'quicklogs',
  'plans',
  'reports',
  'team',
  'roles',
  'settings',
  'profile',
  'todo',
  'projects',
] as const;
export type View = (typeof VIEWS)[number];

const VIEW_OF_PAGE: Partial<Record<Page, View>> = {
  list: 'cases',
  testRuns: 'runs',
  newRun: 'runs',
  quickLogs: 'quicklogs',
  testPlans: 'plans',
  newPlan: 'plans',
  reports: 'reports',
  members: 'team',
  roles: 'roles',
  settings: 'settings',
  profile: 'profile',
  todo: 'todo',
  projects: 'projects',
};

export interface NavIds {
  caseNum?: number;
  cycleId?: string;
  overviewId?: string;
  planId?: string;
  reportsTab?: string | null;
}

/** The query string (with "?", or "" for the dashboard) for a screen. */
export function queryForPage(page: Page, ids: NavIds): string {
  if (page === 'dashboard') return '';
  if (page === 'view' && ids.caseNum) return `?case=${ids.caseNum}`;
  if (page === 'cycle' && ids.cycleId) return `?cycle=${ids.cycleId}`;
  if (page === 'cycleOverview' && ids.overviewId) return `?overview=${ids.overviewId}`;
  if ((page === 'plan' || page === 'editPlan') && ids.planId) return `?plan=${ids.planId}`;
  if (page === 'reports' && ids.reportsTab) return `?view=reports&tab=${ids.reportsTab}`;
  const v = VIEW_OF_PAGE[page];
  if (v) return `?view=${v}`;
  if (page === 'view' || page === 'edit') return '?view=cases';
  if (page === 'cycle' || page === 'cycleOverview') return '?view=runs';
  if (page === 'plan' || page === 'editPlan') return '?view=plans';
  return '';
}

export interface NavParams {
  view?: View;
  cycle?: string;
  overview?: string;
  plan?: string;
  tab?: 'stability' | 'cycleHistory';
}

const ID = /^[A-Za-z0-9_-]{6,64}$/;

/** Reads the screen a link names (anything unrecognised is ignored). */
export function parseNavParams(search: string): NavParams | null {
  const sp = new URLSearchParams(search);
  const out: NavParams = {};
  const view = sp.get('view');
  if (view && (VIEWS as readonly string[]).includes(view)) out.view = view as View;
  for (const k of ['cycle', 'overview', 'plan'] as const) {
    const v = sp.get(k);
    if (v && ID.test(v)) out[k] = v;
  }
  const tab = sp.get('tab');
  if (tab === 'stability' || tab === 'cycleHistory') out.tab = tab;
  return Object.keys(out).length > 0 ? out : null;
}
