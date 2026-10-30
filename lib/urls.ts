// Readable, bookmarkable addresses for every screen. The app is one client-side page
// (served for every path by app/[[...slug]]/page.tsx); this module is the single place
// that turns a screen into a path and a path back into a screen.
//
//   /                                         dashboard (before a workspace is chosen)
//   /workspaces/<ws>/overview                 the workspace's dashboard
//   /projects            /profile
//   /workspaces/<ws>/my-todo
//   /workspaces/<ws>/test-cases[/<portal>/<module>/<section>...]     folders, by name
//   /workspaces/<ws>/cases/c-10504-verify-login                       a test case
//   /workspaces/<ws>/test-runs                                        the board
//   /workspaces/<ws>/test-runs/<name>-<id>[/summary]                  a run
//   /workspaces/<ws>/quick-logs
//   /workspaces/<ws>/test-plans[/<name>-<id>]                         plans
//   /workspaces/<ws>/reports[/stability|/cycle-history]
//   /workspaces/<ws>/team[/roles]      /workspaces/<ws>/settings
//
// <ws> is the workspace's slug. Names become lower-case words joined by hyphens; an
// id is appended where a name alone could repeat (runs, plans).
import type { Page } from '@/types';

export type View =
  | 'dashboard'
  | 'cases'
  | 'runs'
  | 'quicklogs'
  | 'plans'
  | 'reports'
  | 'team'
  | 'roles'
  | 'settings'
  | 'profile'
  | 'todo'
  | 'projects';

/** Lower-case words joined by hyphens: "Stripe Online Payments" -> "stripe-online-payments". */
export function slugify(s: string, max = 60): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '') || ''
  );
}

/** "<name>-<id>" for a record whose id has no hyphens (cuid). */
export const withId = (name: string, id: string): string => {
  const s = slugify(name, 48);
  return s ? `${s}-${id}` : id;
};
export const idOf = (segment: string): string => segment.slice(segment.lastIndexOf('-') + 1);

const ID = /^[A-Za-z0-9_]{6,64}$/;

// ─── Building a path ────────────────────────────────────────────

export interface PathContext {
  workspace?: string | null;
  caseNum?: number;
  caseTitle?: string;
  cycle?: { id: string; name: string } | null;
  overview?: { id: string; name: string } | null;
  plan?: { id: string; name: string } | null;
  reportsTab?: string | null;
}

export const workspacePath = (ws: string) => `/workspaces/${ws}`;

export const caseSegment = (caseNum: number, title = ''): string => {
  const t = slugify(title, 50);
  return `c-${caseNum}${t ? `-${t}` : ''}`;
};

export function casePath(ws: string, caseNum: number, title = ''): string {
  return `${workspacePath(ws)}/cases/${caseSegment(caseNum, title)}`;
}

export function folderPath(ws: string, names: string[]): string {
  const slugs = names.map(n => slugify(n)).filter(Boolean);
  return `${workspacePath(ws)}/test-cases${slugs.length ? '/' + slugs.join('/') : ''}`;
}

/** The path for the open screen ("/" when there is no workspace to name). */
export function pathForPage(page: Page, c: PathContext): string {
  if (page === 'login') return '/';
  if (page === 'projects') return '/projects';
  if (page === 'profile') return '/profile';
  const ws = c.workspace;
  if (!ws) return '/';
  const base = workspacePath(ws);
  switch (page) {
    case 'dashboard':
      return `${base}/overview`;
    case 'todo':
      return `${base}/my-todo`;
    case 'list':
    case 'edit':
      return `${base}/test-cases`;
    case 'view':
      return c.caseNum ? casePath(ws, c.caseNum, c.caseTitle) : `${base}/test-cases`;
    case 'testRuns':
      return `${base}/test-runs`;
    case 'newRun':
      return `${base}/test-runs/new`;
    case 'cycle':
      return c.cycle
        ? `${base}/test-runs/${withId(c.cycle.name, c.cycle.id)}`
        : `${base}/test-runs`;
    case 'cycleOverview':
      return c.overview
        ? `${base}/test-runs/${withId(c.overview.name, c.overview.id)}/summary`
        : `${base}/test-runs`;
    case 'quickLogs':
      return `${base}/quick-logs`;
    case 'testPlans':
      return `${base}/test-plans`;
    case 'newPlan':
      return `${base}/test-plans/new`;
    case 'plan':
      return c.plan ? `${base}/test-plans/${withId(c.plan.name, c.plan.id)}` : `${base}/test-plans`;
    case 'editPlan':
      return c.plan
        ? `${base}/test-plans/${withId(c.plan.name, c.plan.id)}/edit`
        : `${base}/test-plans`;
    case 'reports':
      return `${base}/reports${c.reportsTab === 'stability' ? '/stability' : c.reportsTab === 'cycleHistory' ? '/cycle-history' : ''}`;
    case 'members':
      return `${base}/team`;
    case 'roles':
      return `${base}/team/roles`;
    case 'settings':
      return `${base}/settings`;
    default:
      return '/';
  }
}

// ─── Reading a path ─────────────────────────────────────────────

/** What an address names. Absent fields mean "not named". */
export interface Target {
  workspace?: string;
  view?: View;
  /** Folder names (slugs), outermost first: portal, module, section... */
  folder?: string[];
  /** Older folder links: `s:<id>` / `m:<id>` / `p:<id>`. */
  folderRef?: string;
  caseNum?: number;
  cycle?: string;
  overview?: string;
  plan?: string;
  tab?: 'stability' | 'cycleHistory';
}

export function parseTarget(pathname: string, search = ''): Target | null {
  const sp = new URLSearchParams(search);
  const t: Target = {};

  // Links shared before addresses were readable: /?case=10504, /?folder=s:<id>, /?plan=<id>...
  const caseQ = /^c?-?(\d{1,9})$/i.exec((sp.get('case') ?? '').trim());
  if (caseQ) t.caseNum = Number(caseQ[1]);
  const folderQ = sp.get('folder');
  if (folderQ && /^[pms]:[A-Za-z0-9_-]{6,64}$/.test(folderQ)) t.folderRef = folderQ;
  for (const k of ['cycle', 'overview', 'plan'] as const) {
    const v = sp.get(k);
    if (v && ID.test(v)) t[k] = v;
  }
  const qView = sp.get('view');
  const qViews: Record<string, View> = {
    dashboard: 'dashboard',
    cases: 'cases',
    runs: 'runs',
    quicklogs: 'quicklogs',
    plans: 'plans',
    reports: 'reports',
    team: 'team',
    roles: 'roles',
    settings: 'settings',
    profile: 'profile',
    todo: 'todo',
    projects: 'projects',
  };
  if (qView && qViews[qView]) t.view = qViews[qView];
  const qTab = sp.get('tab');
  if (qTab === 'stability' || qTab === 'cycleHistory') t.tab = qTab;

  const seg = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (seg[0] === 'projects') t.view = 'projects';
  else if (seg[0] === 'profile') t.view = 'profile';
  else if (seg[0] === 'workspaces' && seg[1]) {
    t.workspace = seg[1];
    const [area, a, b] = seg.slice(2);
    switch (area) {
      case 'overview':
        t.view = 'dashboard';
        break;
      case 'my-todo':
        t.view = 'todo';
        break;
      case 'test-cases':
        t.view = 'cases';
        if (seg.length > 3) t.folder = seg.slice(3);
        break;
      case 'cases': {
        const m = /^c-(\d{1,9})(?:-|$)/i.exec(a ?? '');
        if (m) t.caseNum = Number(m[1]);
        else t.view = 'cases';
        break;
      }
      case 'test-runs':
        t.view = 'runs';
        if (a && a !== 'new') {
          const id = idOf(a);
          if (ID.test(id)) {
            if (b === 'summary') t.overview = id;
            else t.cycle = id;
          }
        }
        break;
      case 'quick-logs':
        t.view = 'quicklogs';
        break;
      case 'test-plans':
        t.view = 'plans';
        if (a && a !== 'new') {
          const id = idOf(a);
          if (ID.test(id)) t.plan = id;
        }
        break;
      case 'reports':
        t.view = 'reports';
        if (a === 'stability') t.tab = 'stability';
        else if (a === 'cycle-history') t.tab = 'cycleHistory';
        break;
      case 'team':
        t.view = a === 'roles' ? 'roles' : 'team';
        break;
      case 'settings':
        t.view = 'settings';
        break;
    }
  }
  return Object.keys(t).length > 0 ? t : null;
}

// ─── The folder an address named when the page first loaded ─────
// The repository reads it once, though the address is rewritten as the user signs in
// and moves around before the repository is on screen.

let initialFolder: { folder?: string[]; folderRef?: string } | null = (() => {
  if (typeof window === 'undefined') return null;
  const t = parseTarget(window.location.pathname, window.location.search);
  return t?.folder || t?.folderRef ? { folder: t.folder, folderRef: t.folderRef } : null;
})();

export const peekInitialFolder = () => initialFolder;
export const clearInitialFolder = () => {
  initialFolder = null;
};
