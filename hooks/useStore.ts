'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  TestCase,
  Page,
  Module,
  TestCycle,
  ApiTestCase,
  ApiTestRun,
  CycleSummary,
  CycleScopeType,
  RunResult,
  Project,
  Portal,
} from '@/types';
import { SEED_DATA } from '@/data/testCases';
import { formatCaseId, nextTestCaseId, todayStr } from '@/lib/utils';
import { api } from '@/lib/client';

export type UserRole = 'SuperAdmin' | 'QAManager' | 'Tester' | 'Developer' | 'Viewer';

// Adapt the API shape to the in-memory shape used by the legacy View/Edit screens.
// Display id is always the formatted "TC-NN" — apiId carries the DB cuid for mutations.
function toLocalTestCase(c: ApiTestCase): TestCase {
  const steps = Array.isArray(c.steps)
    ? (c.steps as unknown[]).map(s => String(s))
    : c.steps
      ? [String(c.steps)]
      : [];
  return {
    id: formatCaseId(c.caseNum),
    apiId: c.id,
    caseNum: c.caseNum,
    title: c.title,
    sub: c.sub ?? '',
    priority: c.priority,
    severity: c.severity,
    type: c.type,
    feature: c.suite?.name ?? c.feature?.name ?? '',
    updated: relativeTime(c.updatedAt),
    desc: c.desc ?? '',
    preconditions: c.preconditions ?? '',
    steps,
    expected: c.expected ?? '',
    created: formatDate(c.createdAt),
    author: c.author ?? '',
    updatedFull: formatDate(c.updatedAt),
  };
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl: string | null;
}

interface ApiModuleData {
  id: string;
  name: string;
  suites: { id: string; name: string }[];
}

interface ApiPortalData {
  id: string;
  name: string;
  slug: string | null;
  icon: string | null;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  modules: ApiModuleData[];
}

export interface AppState {
  page: Page;
  data: Record<string, TestCase[]>;
  modules: Module[];
  moduleIds: Record<string, string>; // moduleName → id
  featureIds: Record<string, string>; // "modName:featName" → suiteId (key kept for UI compat)
  currentKey: string;
  currentTC: TestCase | null;
  toast: { msg: string; type?: 'success' | 'error' } | null;

  // ─── Auth ────────────────────────────────────────────────────
  user: SessionUser | null;
  authChecked: boolean;

  // ─── Projects ───────────────────────────────────────────────
  projects: Project[];
  currentProjectId: string | null;

  // ─── Portals (per-project app/product layer) ────────────────
  portals: Portal[];
  currentPortalId: string | null;

  // ─── Cycles (API-backed) ────────────────────────────────────
  cycles: TestCycle[];
  currentCycle: TestCycle | null;
  runs: ApiTestRun[];
  summary: CycleSummary | null;
  cyclesLoading: boolean;
  runsLoading: boolean;

  // Monotonic counter — bumped on test-case create/edit/delete so any subscribed
  // list (e.g. TestCaseList) refetches from the API.
  dataVersion: number;
}

export function useStore() {
  const [state, setState] = useState<AppState>({
    page: 'login',
    data: JSON.parse(JSON.stringify(SEED_DATA)),
    modules: [],
    moduleIds: {},
    featureIds: {},
    currentKey: '',
    currentTC: null,
    toast: null,
    user: null,
    authChecked: false,
    projects: [],
    currentProjectId:
      typeof window !== 'undefined' ? localStorage.getItem('simplitest_project') : null,
    portals: [],
    currentPortalId:
      typeof window !== 'undefined' ? localStorage.getItem('simplitest_portal') : null,
    cycles: [],
    currentCycle: null,
    runs: [],
    summary: null,
    cyclesLoading: false,
    runsLoading: false,
    dataVersion: 0,
  });

  // Recompute modules / moduleIds / featureIds for a given portal's data.
  const applyPortalModules = useCallback((apiModules: ApiModuleData[], preserveKey?: string) => {
    const modules: Module[] = apiModules.map(m => ({
      name: m.name,
      features: m.suites.map(s => s.name),
    }));
    const moduleIds: Record<string, string> = Object.fromEntries(
      apiModules.map(m => [m.name, m.id]),
    );
    const featureIds: Record<string, string> = {};
    for (const m of apiModules) {
      for (const s of m.suites) {
        featureIds[`${m.name}:${s.name}`] = s.id;
      }
    }
    setState(s => {
      let currentKey = preserveKey !== undefined ? preserveKey : s.currentKey;
      const exists = currentKey && featureIds[currentKey];
      if (!exists) {
        const first = apiModules.find(m => m.suites.length > 0);
        currentKey = first ? `${first.name}:${first.suites[0].name}` : '';
      }
      return { ...s, modules, moduleIds, featureIds, currentKey };
    });
  }, []);

  // Fetch the portals (with nested modules + suites) for a project.
  // Picks a sensible default portal and applies its folder tree to the sidebar.
  const reloadPortals = useCallback(
    async (projectId?: string | null): Promise<ApiPortalData[]> => {
      try {
        if (!projectId) {
          setState(s => ({
            ...s,
            portals: [],
            currentPortalId: null,
            modules: [],
            moduleIds: {},
            featureIds: {},
            currentKey: '',
          }));
          return [];
        }
        const apiPortals = await api.get<ApiPortalData[]>(`/api/portals?projectId=${projectId}`);
        const portals: Portal[] = apiPortals.map(p => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          icon: p.icon,
          projectId: p.projectId,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          _count: { modules: p.modules.length },
        }));

        const stored =
          typeof window !== 'undefined' ? localStorage.getItem('simplitest_portal') : null;
        let activePortalId =
          (stored && apiPortals.some(p => p.id === stored) ? stored : apiPortals[0]?.id) ?? null;
        if (activePortalId && typeof window !== 'undefined') {
          localStorage.setItem('simplitest_portal', activePortalId);
        }
        const active = apiPortals.find(p => p.id === activePortalId);

        setState(s => ({
          ...s,
          portals,
          currentPortalId: activePortalId,
        }));
        applyPortalModules(active?.modules ?? []);
        return apiPortals;
      } catch (e) {
        console.error('[reloadPortals]', e);
        return [];
      }
    },
    [applyPortalModules],
  );

  // Reload only the current portal's module tree (e.g. after adding/deleting a module/suite).
  const reloadModules = useCallback(
    async (portalIdOverride?: string | null) => {
      try {
        let portalId = portalIdOverride;
        if (portalId === undefined) {
          portalId = state.currentPortalId;
        }
        if (!portalId) {
          setState(s => ({ ...s, modules: [], moduleIds: {}, featureIds: {} }));
          return;
        }
        const apiModules = await api.get<ApiModuleData[]>(`/api/modules?portalId=${portalId}`);
        applyPortalModules(apiModules);
      } catch (e) {
        console.error('[reloadModules]', e);
      }
    },
    [applyPortalModules, state.currentPortalId],
  );

  // Fetch the list of projects + pick a sensible default
  const reloadProjects = useCallback(async (): Promise<Project[]> => {
    try {
      const list = await api.get<Project[]>('/api/projects');
      setState(s => {
        let currentProjectId = s.currentProjectId;
        if (!currentProjectId || !list.some(p => p.id === currentProjectId)) {
          currentProjectId = list[0]?.id ?? null;
          if (typeof window !== 'undefined' && currentProjectId) {
            localStorage.setItem('simplitest_project', currentProjectId);
          }
        }
        return { ...s, projects: list, currentProjectId };
      });
      return list;
    } catch (e) {
      console.error('[reloadProjects]', e);
      return [];
    }
  }, []);

  // Check session on mount
  useEffect(() => {
    (async () => {
      try {
        const { user } = await api.get<{ user: SessionUser | null }>('/api/auth/me');
        setState(s => ({
          ...s,
          user,
          authChecked: true,
          page: user ? 'dashboard' : 'login',
        }));
        if (user) {
          const projects = await reloadProjects();
          const stored =
            typeof window !== 'undefined' ? localStorage.getItem('simplitest_project') : null;
          const activeId =
            (stored && projects.some(p => p.id === stored) ? stored : projects[0]?.id) ?? null;
          if (activeId) await reloadPortals(activeId);
        }
      } catch {
        setState(s => ({ ...s, authChecked: true, page: 'login' }));
      }
    })();
  }, [reloadPortals]);

  const update = useCallback((patch: Partial<AppState>) => {
    setState(s => ({ ...s, ...patch }));
  }, []);

  const showToast = useCallback((msg: string, type?: 'success' | 'error') => {
    setState(s => ({ ...s, toast: { msg, type } }));
    setTimeout(() => setState(s => ({ ...s, toast: null })), 2800);
  }, []);

  // ─── Portal actions ────────────────────────────────────────
  const switchPortal = useCallback(
    async (portalId: string) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('simplitest_portal', portalId);
      }
      setState(s => ({
        ...s,
        currentPortalId: portalId,
        modules: [],
        moduleIds: {},
        featureIds: {},
        currentKey: '',
      }));
      try {
        const apiModules = await api.get<ApiModuleData[]>(`/api/modules?portalId=${portalId}`);
        applyPortalModules(apiModules);
      } catch (e) {
        console.error('[switchPortal]', e);
      }
    },
    [applyPortalModules],
  );

  const addPortal = useCallback(
    async (name: string, icon?: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const projectId = state.currentProjectId;
      if (!projectId) {
        showToast('No project selected', 'error');
        return null;
      }
      try {
        const portal = await api.post<Portal>('/api/portals', {
          name: trimmed,
          projectId,
          icon: icon || undefined,
        });
        if (typeof window !== 'undefined') {
          localStorage.setItem('simplitest_portal', portal.id);
        }
        await reloadPortals(projectId);
        // reloadPortals will pick its own active portal from localStorage, which we just set
        showToast(`Portal "${trimmed}" added ✓`, 'success');
        return portal;
      } catch (e) {
        showToast((e as Error).message, 'error');
        return null;
      }
    },
    [reloadPortals, showToast, state.currentProjectId],
  );

  const deletePortal = useCallback(
    async (portalId: string) => {
      const projectId = state.currentProjectId;
      try {
        await api.del(`/api/portals/${portalId}`);
        if (typeof window !== 'undefined') {
          if (localStorage.getItem('simplitest_portal') === portalId) {
            localStorage.removeItem('simplitest_portal');
          }
        }
        await reloadPortals(projectId);
        showToast('Portal deleted', 'success');
      } catch (e) {
        showToast((e as Error).message, 'error');
      }
    },
    [reloadPortals, showToast, state.currentProjectId],
  );

  const renamePortal = useCallback(
    async (portalId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const projectId = state.currentProjectId;
      try {
        await api.patch(`/api/portals/${portalId}`, { name: trimmed });
        await reloadPortals(projectId);
        showToast('Portal renamed ✓', 'success');
      } catch (e) {
        showToast((e as Error).message, 'error');
      }
    },
    [reloadPortals, showToast, state.currentProjectId],
  );

  // ─── Project actions ───────────────────────────────────────
  const switchProject = useCallback(
    async (projectId: string) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('simplitest_project', projectId);
        // Drop the per-project portal selection so each project picks its own default.
        localStorage.removeItem('simplitest_portal');
      }
      setState(s => ({
        ...s,
        currentProjectId: projectId,
        portals: [],
        currentPortalId: null,
        modules: [],
        moduleIds: {},
        featureIds: {},
        cycles: [],
        currentKey: '',
      }));
      await reloadPortals(projectId);
    },
    [reloadPortals],
  );

  const createProject = useCallback(
    async (name: string) => {
      try {
        const project = await api.post<Project>('/api/projects', { name });
        await reloadProjects();
        if (typeof window !== 'undefined') {
          localStorage.setItem('simplitest_project', project.id);
          localStorage.removeItem('simplitest_portal');
        }
        // Auto-create a Main portal so the project starts usable.
        try {
          await api.post('/api/portals', { name: 'Main', projectId: project.id });
        } catch {
          /* tolerate races */
        }
        setState(s => ({ ...s, currentProjectId: project.id }));
        await reloadPortals(project.id);
        showToast(`Project "${name}" created ✓`, 'success');
        return project;
      } catch (e) {
        showToast((e as Error).message, 'error');
        return null;
      }
    },
    [reloadProjects, reloadPortals, showToast],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      try {
        await api.del(`/api/projects/${projectId}`);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('simplitest_project');
          localStorage.removeItem('simplitest_portal');
        }
        const list = await reloadProjects();
        const next = list[0]?.id ?? null;
        setState(s => ({ ...s, currentProjectId: next }));
        await reloadPortals(next);
        showToast('Project deleted', 'success');
      } catch (e) {
        showToast((e as Error).message, 'error');
      }
    },
    [reloadProjects, reloadPortals, showToast],
  );

  const login = useCallback(
    async (user: SessionUser) => {
      setState(s => ({ ...s, user, page: 'dashboard' }));
      const projects = await reloadProjects();
      const activeId = projects[0]?.id ?? null;
      if (activeId) await reloadPortals(activeId);
    },
    [reloadProjects, reloadPortals],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignore */
    }
    setState(s => ({ ...s, user: null, page: 'login' }));
  }, []);

  const showDashboard = useCallback(() => update({ page: 'dashboard' }), [update]);
  const showReports = useCallback(() => update({ page: 'reports' }), [update]);
  const showMembers = useCallback(() => update({ page: 'members' }), [update]);
  const showPlans = useCallback(() => update({ page: 'plans' }), [update]);
  const showPlatforms = useCallback(() => update({ page: 'platforms' }), [update]);
  const showSettings = useCallback(() => update({ page: 'settings' }), [update]);
  const showProfile = useCallback(() => update({ page: 'profile' }), [update]);

  // Refresh the in-memory `user` after a profile edit so sidebar / avatar update immediately.
  const refreshSessionUser = useCallback(async () => {
    try {
      const { user: fresh } = await api.get<{ user: SessionUser | null }>('/api/auth/me');
      setState(s => ({ ...s, user: fresh }));
    } catch {
      /* silent */
    }
  }, []);

  const showTestCases = useCallback(() => {
    setState(s => ({ ...s, page: 'list' }));
  }, []);

  const navFeature = useCallback(
    (mod: string, feat: string) => {
      update({ page: 'list', currentKey: `${mod}:${feat}` });
    },
    [update],
  );

  const viewTC = useCallback((id: string) => {
    setState(s => {
      const tc = (s.data[s.currentKey] || []).find(c => c.id === id) || null;
      return { ...s, currentTC: tc, page: 'view' };
    });
  }, []);

  // Open a row clicked from the API-driven Test Cases table. Maps the ApiTestCase shape
  // into the legacy local TestCase shape the View/Edit screens were built against,
  // populates state.data[currentKey] so prev/next nav still works, and switches to the view page.
  const viewApiCase = useCallback((apiCase: ApiTestCase, apiList: ApiTestCase[]) => {
    const localCases: TestCase[] = apiList.map(toLocalTestCase);
    // Match by apiId (cuid) — local ids are the formatted TC-NN which may collide if multiple
    // pages of cases share caseNums, but cuids are unique.
    const current = localCases.find(c => c.apiId === apiCase.id) ?? toLocalTestCase(apiCase);
    setState(s => ({
      ...s,
      data: { ...s.data, [s.currentKey]: localCases },
      currentTC: current,
      page: 'view',
    }));
  }, []);

  const showEdit = useCallback(() => update({ page: 'edit' }), [update]);
  const showCreate = useCallback(() => update({ page: 'create' }), [update]);
  const cancelCreate = useCallback(() => update({ page: 'list' }), [update]);

  const addModule = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const portalId = state.currentPortalId;
      if (!portalId) {
        showToast('No portal selected — create one first', 'error');
        return;
      }
      try {
        await api.post('/api/modules', { name: trimmed, portalId });
        await reloadModules(portalId);
        showToast(`Folder "${trimmed}" added ✓`, 'success');
      } catch (e) {
        showToast((e as Error).message, 'error');
      }
    },
    [reloadModules, showToast, state.currentPortalId],
  );

  const addFeature = useCallback(
    async (modName: string, featName: string) => {
      const trimmed = featName.trim();
      if (!trimmed) return;
      setState(currentState => {
        const moduleId = currentState.moduleIds[modName];
        if (!moduleId) {
          showToast(`Folder "${modName}" not found`, 'error');
          return currentState;
        }
        // fire-and-forget; we'll reload below
        api
          .post('/api/features', { name: trimmed, moduleId })
          .then(async () => {
            await reloadModules(state.currentPortalId);
            setState(s => ({ ...s, currentKey: `${modName}:${trimmed}`, page: 'list' }));
            showToast(`Folder "${trimmed}" added ✓`, 'success');
          })
          .catch(e => showToast((e as Error).message, 'error'));
        return currentState;
      });
    },
    [reloadModules, showToast, state.currentPortalId],
  );

  const deleteModule = useCallback(
    async (modName: string) => {
      setState(currentState => {
        const id = currentState.moduleIds[modName];
        if (!id) {
          showToast(`Folder "${modName}" not found`, 'error');
          return currentState;
        }
        api
          .del(`/api/modules/${id}`)
          .then(async () => {
            await reloadModules(state.currentPortalId);
            // If currentKey was under this module, fall back to first remaining
            setState(s => {
              const data: Record<string, TestCase[]> = {};
              for (const k of Object.keys(s.data)) {
                if (!k.startsWith(`${modName}:`)) data[k] = s.data[k];
              }
              let currentKey = s.currentKey;
              if (currentKey.startsWith(`${modName}:`)) {
                const first = s.modules[0];
                currentKey = first && first.features[0] ? `${first.name}:${first.features[0]}` : '';
              }
              return { ...s, data, currentKey };
            });
            showToast(`Folder "${modName}" deleted`, 'success');
          })
          .catch(e => showToast((e as Error).message, 'error'));
        return currentState;
      });
    },
    [reloadModules, showToast, state.currentPortalId],
  );

  const deleteFeature = useCallback(
    async (modName: string, featName: string) => {
      setState(currentState => {
        const id = currentState.featureIds[`${modName}:${featName}`];
        if (!id) {
          showToast(`Folder "${featName}" not found`, 'error');
          return currentState;
        }
        api
          .del(`/api/features/${id}`)
          .then(async () => {
            await reloadModules(state.currentPortalId);
            setState(s => {
              const key = `${modName}:${featName}`;
              const { [key]: _removed, ...data } = s.data;
              let currentKey = s.currentKey;
              if (currentKey === key) {
                const mod = s.modules.find(m => m.name === modName);
                if (mod && mod.features.length > 0) {
                  currentKey = `${modName}:${mod.features[0]}`;
                } else {
                  const first = s.modules.find(m => m.features.length > 0);
                  currentKey = first ? `${first.name}:${first.features[0]}` : '';
                }
              }
              return { ...s, data, currentKey };
            });
            showToast(`Folder "${featName}" deleted`, 'success');
          })
          .catch(e => showToast((e as Error).message, 'error'));
        return currentState;
      });
    },
    [reloadModules, showToast, state.currentProjectId],
  );

  // Persisted edit — PATCHes /api/test-cases/:apiId, then updates the in-memory copy.
  // Falls back to a local-only edit if the case has no apiId (legacy seed data).
  const saveEdit = useCallback(
    async (patch: Partial<TestCase>) => {
      // Snapshot the current case + apiId before async work.
      const current = state.currentTC;
      if (!current) return;

      const persisted = current.apiId
        ? await (async () => {
            try {
              const updated = await api.patch<ApiTestCase>(`/api/test-cases/${current.apiId}`, {
                title: patch.title,
                desc: patch.desc,
                preconditions: patch.preconditions,
                expected: patch.expected,
                steps: patch.steps,
                priority: patch.priority,
                severity: patch.severity,
                type: patch.type,
              });
              return toLocalTestCase(updated);
            } catch (e) {
              showToast(`Save failed: ${(e as Error).message}`, 'error');
              return null;
            }
          })()
        : null;

      setState(s => {
        if (!s.currentTC) return s;
        const cases = [...(s.data[s.currentKey] || [])];
        const idx = cases.findIndex(c => c.id === s.currentTC!.id);
        if (idx < 0) return s;
        const merged: TestCase = persisted ?? {
          ...s.currentTC,
          ...patch,
          updatedFull: 'Just now',
          updated: 'Just now',
        };
        cases[idx] = merged;
        return {
          ...s,
          data: { ...s.data, [s.currentKey]: cases },
          currentTC: merged,
          page: 'view',
          dataVersion: s.dataVersion + 1,
        };
      });
      showToast('Test case saved ✓', 'success');
    },
    [showToast, state.currentTC],
  );

  // Persisted delete — DELETEs /api/test-cases/:apiId. Local removal happens regardless
  // so the UI is responsive; failures show a toast and a list reload will recover.
  const deleteTC = useCallback(
    async (id: string) => {
      const target = (state.data[state.currentKey] || []).find(c => c.id === id);
      const apiId = target?.apiId;
      setState(s => {
        const cases = (s.data[s.currentKey] || []).filter(c => c.id !== id);
        return {
          ...s,
          data: { ...s.data, [s.currentKey]: cases },
          page: 'list',
          dataVersion: s.dataVersion + 1,
        };
      });
      if (apiId) {
        try {
          await api.del(`/api/test-cases/${apiId}`);
        } catch (e) {
          showToast(`Delete failed: ${(e as Error).message}`, 'error');
          // Bump dataVersion again so the list re-fetches and the case re-appears.
          setState(s => ({ ...s, dataVersion: s.dataVersion + 1 }));
          return;
        }
      }
      showToast('Test case deleted');
    },
    [showToast, state.data, state.currentKey],
  );

  const duplicateTC = useCallback(() => {
    setState(s => {
      if (!s.currentTC) return s;
      const dup: TestCase = {
        ...s.currentTC,
        id: nextTestCaseId(),
        title: s.currentTC.title + ' (copy)',
        updated: 'just now',
        updatedFull: todayStr(),
      };
      const cases = [...(s.data[s.currentKey] || []), dup];
      return { ...s, data: { ...s.data, [s.currentKey]: cases }, page: 'list' };
    });
    showToast('Test case duplicated');
  }, [showToast]);

  // Persisted create — POSTs to /api/test-cases. The new case picks up a real auto-incrementing
  // caseNum from the DB and the list refetches via the dataVersion bump.
  const createTC = useCallback(
    async (
      tc: Omit<TestCase, 'id' | 'created' | 'updatedFull' | 'updated' | 'sub' | 'author'> & {
        module: string;
      },
    ) => {
      const key = `${tc.module}:${tc.feature}`;
      // Resolve suiteId from useStore's featureIds map populated by reloadModules.
      const suiteId = state.featureIds[key];
      if (!suiteId) {
        showToast(
          `Couldn't find suite "${tc.feature}" under module "${tc.module}". Pick a suite first.`,
          'error',
        );
        return;
      }
      const userName = state.user?.name || state.user?.username || 'You';
      try {
        const created = await api.post<ApiTestCase>('/api/test-cases', {
          title: tc.title,
          sub: tc.desc?.split('.')[0] || tc.title,
          desc: tc.desc,
          preconditions: (tc as { preconditions?: string }).preconditions ?? '',
          steps: tc.steps,
          expected: tc.expected,
          priority: tc.priority,
          severity: tc.severity,
          type: tc.type,
          suiteId,
          author: userName,
        });
        const local = toLocalTestCase(created);
        setState(s => {
          const cases = [...(s.data[key] || []), local];
          return {
            ...s,
            data: { ...s.data, [key]: cases },
            currentKey: key,
            page: 'list',
            dataVersion: s.dataVersion + 1,
          };
        });
        showToast(`Test case ${local.id} created ✓`, 'success');
      } catch (e) {
        showToast(`Create failed: ${(e as Error).message}`, 'error');
      }
    },
    [showToast, state.featureIds, state.user],
  );

  // ─── Cycles ────────────────────────────────────────────────

  const loadCycles = useCallback(async () => {
    setState(s => ({ ...s, cyclesLoading: true }));
    try {
      const projectId = state.currentProjectId;
      const url = projectId ? `/api/cycles?projectId=${projectId}` : '/api/cycles';
      const cycles = await api.get<TestCycle[]>(url);
      setState(s => ({ ...s, cycles, cyclesLoading: false }));
    } catch (e) {
      setState(s => ({ ...s, cyclesLoading: false }));
      showToast(`Failed to load cycles: ${(e as Error).message}`, 'error');
    }
  }, [showToast, state.currentProjectId]);

  const showCycles = useCallback(() => {
    setState(s => ({ ...s, page: 'cycles' }));
    loadCycles();
  }, [loadCycles]);

  const openCycle = useCallback(
    async (cycleId: string) => {
      setState(s => ({
        ...s,
        page: 'cycle',
        currentCycle: s.cycles.find(c => c.id === cycleId) || null,
        runs: [],
        summary: null,
        runsLoading: true,
      }));
      try {
        const [runs, summary, cycle] = await Promise.all([
          api.get<ApiTestRun[]>(`/api/cycles/${cycleId}/runs`),
          api.get<CycleSummary>(`/api/cycles/${cycleId}/summary`),
          api.get<TestCycle>(`/api/cycles/${cycleId}`),
        ]);
        setState(s => ({ ...s, runs, summary, currentCycle: cycle, runsLoading: false }));
      } catch (e) {
        setState(s => ({ ...s, runsLoading: false }));
        showToast(`Failed to open cycle: ${(e as Error).message}`, 'error');
      }
    },
    [showToast],
  );

  const backToCycles = useCallback(() => {
    setState(s => ({ ...s, page: 'cycles', currentCycle: null, runs: [], summary: null }));
  }, []);

  const createCycle = useCallback(
    async (input: {
      name: string;
      description?: string;
      mode?: 'CaseBased' | 'Manual';
      scopeType?: CycleScopeType;
      scopeId?: string | null;
      testCaseIds?: string[];
      targetDate?: string | null;
      // Manual-mode fields (all optional, ignored for CaseBased)
      moduleName?: string;
      featureName?: string;
      environment?: string;
      platform?: string;
      version?: string;
      cycleCategory?: string;
      ticketLink?: string;
      issueCount?: number;
      criticalCount?: number;
      majorCount?: number;
      minorCount?: number;
      doneCount?: number;
      remainingCount?: number;
      passedCount?: number;
      failedCount?: number;
      blockedCount?: number;
    }) => {
      const projectId = state.currentProjectId;
      if (!projectId) {
        showToast('No project selected', 'error');
        return;
      }
      try {
        await api.post<TestCycle>('/api/cycles', { ...input, projectId });
        showToast(
          input.mode === 'Manual' ? 'Quick-log cycle saved ✓' : 'Cycle created ✓',
          'success',
        );
        await loadCycles();
      } catch (e) {
        showToast(`Failed to create cycle: ${(e as Error).message}`, 'error');
      }
    },
    [loadCycles, showToast, state.currentProjectId],
  );

  // Patch any subset of fields on a cycle — used by the manual edit modal.
  const updateCycle = useCallback(
    async (cycleId: string, patch: Record<string, unknown>) => {
      try {
        await api.patch<TestCycle>(`/api/cycles/${cycleId}`, patch);
        showToast('Cycle updated ✓', 'success');
        await loadCycles();
      } catch (e) {
        showToast(`Update failed: ${(e as Error).message}`, 'error');
      }
    },
    [loadCycles, showToast],
  );

  const archiveCycle = useCallback(
    async (cycleId: string) => {
      try {
        await api.patch<TestCycle>(`/api/cycles/${cycleId}`, { status: 'Archived' });
        showToast('Test run archived');
        await loadCycles();
      } catch (e) {
        showToast(`Failed to archive: ${(e as Error).message}`, 'error');
      }
    },
    [loadCycles, showToast],
  );

  // Repopulate a cycle's runs by re-evaluating its scope. Useful when a cycle was
  // created against a scope that had zero matching cases (so runs.length === 0).
  const regenerateCycle = useCallback(
    async (cycleId: string) => {
      try {
        const res = await api.post<{ added: number; matched: number; message: string }>(
          `/api/cycles/${cycleId}/regenerate`,
        );
        if (res.added === 0) {
          showToast(res.message, res.matched === 0 ? 'error' : 'success');
        } else {
          showToast(`Added ${res.added} test case run(s) ✓`, 'success');
        }
        // Re-open the cycle so runs reload from the server.
        if (state.currentCycle?.id === cycleId) {
          const [runs, summary, cycle] = await Promise.all([
            api.get<ApiTestRun[]>(`/api/cycles/${cycleId}/runs`),
            api.get<CycleSummary>(`/api/cycles/${cycleId}/summary`),
            api.get<TestCycle>(`/api/cycles/${cycleId}`),
          ]);
          setState(s => ({ ...s, runs, summary, currentCycle: cycle }));
        }
        await loadCycles();
      } catch (e) {
        showToast(`Regenerate failed: ${(e as Error).message}`, 'error');
      }
    },
    [showToast, loadCycles, state.currentCycle],
  );

  // Mark a run as Completed — keeps it visible but read-only for the team.
  const closeCycle = useCallback(
    async (cycleId: string) => {
      try {
        const updated = await api.patch<TestCycle>(`/api/cycles/${cycleId}`, {
          status: 'Completed',
        });
        showToast('Test run closed ✓', 'success');
        await loadCycles();
        // If user is on this cycle's detail screen, refresh local copy so the badge/buttons update.
        setState(s =>
          s.currentCycle?.id === cycleId
            ? { ...s, currentCycle: { ...s.currentCycle, ...updated } }
            : s,
        );
      } catch (e) {
        showToast(`Failed to close: ${(e as Error).message}`, 'error');
      }
    },
    [loadCycles, showToast],
  );

  const deleteCycle = useCallback(
    async (cycleId: string) => {
      try {
        await api.del<{ deleted: boolean }>(`/api/cycles/${cycleId}`);
        showToast('Test run deleted');
        await loadCycles();
      } catch (e) {
        showToast(`Failed to delete: ${(e as Error).message}`, 'error');
      }
    },
    [loadCycles, showToast],
  );

  const submitResult = useCallback(
    async (runId: string, result: RunResult, notes?: string) => {
      try {
        const updated = await api.patch<ApiTestRun>(`/api/runs/${runId}`, {
          result,
          ...(notes !== undefined ? { notes } : {}),
        });
        // Update local run + refresh summary in one go
        setState(s => ({
          ...s,
          runs: s.runs.map(r => (r.id === runId ? updated : r)),
        }));
        // Refresh summary
        if (state.currentCycle) {
          const summary = await api.get<CycleSummary>(
            `/api/cycles/${state.currentCycle.id}/summary`,
          );
          setState(s => ({ ...s, summary }));
        }
        showToast('Result saved ✓', 'success');
      } catch (e) {
        showToast(`Failed to save: ${(e as Error).message}`, 'error');
      }
    },
    [showToast, state.currentCycle],
  );

  const currentCases = state.data[state.currentKey] || [];

  return {
    state,
    currentCases,
    login,
    logout,
    navFeature,
    viewTC,
    showEdit,
    showCreate,
    cancelCreate,
    saveEdit,
    deleteTC,
    duplicateTC,
    createTC,
    addModule,
    addFeature,
    deleteModule,
    deleteFeature,
    showToast,
    showDashboard,
    showTestCases,
    showCycles,
    openCycle,
    backToCycles,
    createCycle,
    archiveCycle,
    deleteCycle,
    submitResult,
    loadCycles,
    switchProject,
    createProject,
    deleteProject,
    switchPortal,
    addPortal,
    deletePortal,
    renamePortal,
    closeCycle,
    showReports,
    showMembers,
    showPlans,
    showPlatforms,
    showSettings,
    showProfile,
    refreshSessionUser,
    reloadProjects,
    reloadPortals,
    viewApiCase,
    regenerateCycle,
    updateCycle,
  };
}
