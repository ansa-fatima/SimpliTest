'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  TestCase, Page, Module, MODULES,
  TestCycle, ApiTestRun, CycleSummary, CycleScopeType, RunResult,
} from '@/types';
import { SEED_DATA } from '@/data/testCases';
import { nextTestCaseId, todayStr } from '@/lib/utils';
import { api } from '@/lib/client';

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  name: string;
}

export interface AppState {
  page: Page;
  data: Record<string, TestCase[]>;
  modules: Module[];
  currentKey: string;
  currentTC: TestCase | null;
  toast: { msg: string; type?: 'success' | 'error' } | null;

  // ─── Auth ────────────────────────────────────────────────────
  user: SessionUser | null;
  authChecked: boolean;

  // ─── Cycles (API-backed) ────────────────────────────────────
  cycles: TestCycle[];
  currentCycle: TestCycle | null;
  runs: ApiTestRun[];
  summary: CycleSummary | null;
  cyclesLoading: boolean;
  runsLoading: boolean;
}

export function useStore() {
  const [state, setState] = useState<AppState>({
    page: 'login',
    data: JSON.parse(JSON.stringify(SEED_DATA)),
    modules: JSON.parse(JSON.stringify(MODULES)),
    currentKey: 'Authentication:Password Reset',
    currentTC: null,
    toast: null,
    user: null,
    authChecked: false,
    cycles: [],
    currentCycle: null,
    runs: [],
    summary: null,
    cyclesLoading: false,
    runsLoading: false,
  });

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
      } catch {
        setState(s => ({ ...s, authChecked: true, page: 'login' }));
      }
    })();
  }, []);

  const update = useCallback((patch: Partial<AppState>) => {
    setState(s => ({ ...s, ...patch }));
  }, []);

  const showToast = useCallback((msg: string, type?: 'success' | 'error') => {
    setState(s => ({ ...s, toast: { msg, type } }));
    setTimeout(() => setState(s => ({ ...s, toast: null })), 2800);
  }, []);

  const login = useCallback((user: SessionUser) => {
    setState(s => ({ ...s, user, page: 'dashboard', currentKey: 'Authentication:Password Reset' }));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch { /* ignore */ }
    setState(s => ({ ...s, user: null, page: 'login' }));
  }, []);

  const showDashboard = useCallback(() => update({ page: 'dashboard' }), [update]);

  const showTestCases = useCallback(() => {
    setState(s => ({ ...s, page: 'list' }));
  }, []);

  const navFeature = useCallback((mod: string, feat: string) => {
    update({ page: 'list', currentKey: `${mod}:${feat}` });
  }, [update]);

  const viewTC = useCallback((id: string) => {
    setState(s => {
      const tc = (s.data[s.currentKey] || []).find(c => c.id === id) || null;
      return { ...s, currentTC: tc, page: 'view' };
    });
  }, []);

  const showEdit = useCallback(() => update({ page: 'edit' }), [update]);
  const showCreate = useCallback(() => update({ page: 'create' }), [update]);
  const cancelCreate = useCallback(() => update({ page: 'list' }), [update]);

  const addModule = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setState(s => {
      if (s.modules.some(m => m.name.toLowerCase() === trimmed.toLowerCase())) {
        return { ...s, toast: { msg: 'Module already exists', type: 'error' } };
      }
      return {
        ...s,
        modules: [...s.modules, { name: trimmed, features: [] }],
        toast: { msg: `Module "${trimmed}" added ✓`, type: 'success' },
      };
    });
    setTimeout(() => setState(s => ({ ...s, toast: null })), 2800);
  }, []);

  const addFeature = useCallback((modName: string, featName: string) => {
    const trimmed = featName.trim();
    if (!trimmed) return;
    setState(s => {
      const mod = s.modules.find(m => m.name === modName);
      if (!mod) return s;
      if (mod.features.some(f => f.toLowerCase() === trimmed.toLowerCase())) {
        return { ...s, toast: { msg: 'Feature already exists', type: 'error' } };
      }
      const modules = s.modules.map(m =>
        m.name === modName ? { ...m, features: [...m.features, trimmed] } : m
      );
      return {
        ...s,
        modules,
        currentKey: `${modName}:${trimmed}`,
        page: 'list',
        toast: { msg: `Feature "${trimmed}" added ✓`, type: 'success' },
      };
    });
    setTimeout(() => setState(s => ({ ...s, toast: null })), 2800);
  }, []);

  const saveEdit = useCallback((patch: Partial<TestCase>) => {
    setState(s => {
      if (!s.currentTC) return s;
      const cases = [...(s.data[s.currentKey] || [])];
      const idx = cases.findIndex(c => c.id === s.currentTC!.id);
      if (idx < 0) return s;
      const updated: TestCase = { ...s.currentTC, ...patch, updatedFull: 'Just now', updated: 'Just now' };
      cases[idx] = updated;
      return {
        ...s,
        data: { ...s.data, [s.currentKey]: cases },
        currentTC: updated,
        page: 'view',
      };
    });
    showToast('Test case saved ✓', 'success');
  }, [showToast]);

  const deleteTC = useCallback((id: string) => {
    setState(s => {
      const cases = (s.data[s.currentKey] || []).filter(c => c.id !== id);
      return { ...s, data: { ...s.data, [s.currentKey]: cases }, page: 'list' };
    });
    showToast('Test case deleted');
  }, [showToast]);

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

  const createTC = useCallback((tc: Omit<TestCase, 'id' | 'created' | 'updatedFull' | 'updated' | 'sub' | 'author'> & { module: string }) => {
    const key = `${tc.module}:${tc.feature}`;
    const newCase: TestCase = {
      id: nextTestCaseId(),
      title: tc.title,
      sub: tc.desc?.split('.')[0] || tc.title,
      priority: tc.priority,
      severity: tc.severity,
      type: tc.type,
      feature: tc.feature,
      updated: 'just now',
      desc: tc.desc,
      steps: tc.steps,
      expected: tc.expected,
      created: todayStr(),
      author: 'You',
      updatedFull: todayStr(),
    };
    setState(s => {
      const cases = [...(s.data[key] || []), newCase];
      return {
        ...s,
        data: { ...s.data, [key]: cases },
        currentKey: key,
        page: 'list',
      };
    });
    showToast('Test case created ✓', 'success');
  }, [showToast]);

  // ─── Cycles ────────────────────────────────────────────────

  const loadCycles = useCallback(async () => {
    setState(s => ({ ...s, cyclesLoading: true }));
    try {
      const cycles = await api.get<TestCycle[]>('/api/cycles');
      setState(s => ({ ...s, cycles, cyclesLoading: false }));
    } catch (e) {
      setState(s => ({ ...s, cyclesLoading: false }));
      showToast(`Failed to load cycles: ${(e as Error).message}`, 'error');
    }
  }, [showToast]);

  const showCycles = useCallback(() => {
    setState(s => ({ ...s, page: 'cycles' }));
    loadCycles();
  }, [loadCycles]);

  const openCycle = useCallback(async (cycleId: string) => {
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
  }, [showToast]);

  const backToCycles = useCallback(() => {
    setState(s => ({ ...s, page: 'cycles', currentCycle: null, runs: [], summary: null }));
  }, []);

  const createCycle = useCallback(async (input: {
    name: string; description?: string;
    scopeType: CycleScopeType; scopeId?: string | null;
    testCaseIds?: string[];
    targetDate?: string | null;
  }) => {
    try {
      await api.post<TestCycle>('/api/cycles', input);
      showToast('Cycle created ✓', 'success');
      await loadCycles();
    } catch (e) {
      showToast(`Failed to create cycle: ${(e as Error).message}`, 'error');
    }
  }, [loadCycles, showToast]);

  const archiveCycle = useCallback(async (cycleId: string) => {
    try {
      await api.del<{ archived: boolean }>(`/api/cycles/${cycleId}`);
      showToast('Cycle archived');
      await loadCycles();
    } catch (e) {
      showToast(`Failed to archive: ${(e as Error).message}`, 'error');
    }
  }, [loadCycles, showToast]);

  const submitResult = useCallback(async (runId: string, result: RunResult, notes?: string) => {
    try {
      const updated = await api.patch<ApiTestRun>(`/api/runs/${runId}`, { result, ...(notes !== undefined ? { notes } : {}) });
      // Update local run + refresh summary in one go
      setState(s => ({
        ...s,
        runs: s.runs.map(r => r.id === runId ? updated : r),
      }));
      // Refresh summary
      if (state.currentCycle) {
        const summary = await api.get<CycleSummary>(`/api/cycles/${state.currentCycle.id}/summary`);
        setState(s => ({ ...s, summary }));
      }
      showToast('Result saved ✓', 'success');
    } catch (e) {
      showToast(`Failed to save: ${(e as Error).message}`, 'error');
    }
  }, [showToast, state.currentCycle]);

  const currentCases = state.data[state.currentKey] || [];

  return {
    state,
    currentCases,
    login, logout, navFeature,
    viewTC, showEdit, showCreate, cancelCreate,
    saveEdit, deleteTC, duplicateTC, createTC,
    addModule, addFeature, showToast,
    showDashboard, showTestCases,
    showCycles, openCycle, backToCycles,
    createCycle, archiveCycle, submitResult,
    loadCycles,
  };
}
