'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiTestCase, CaseStatus, Priority, TestType, UserSummary } from '@/types';
import { api } from '@/lib/client';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { avatarColour, cn, initials, priorityBadge, statusBadge, typeBadge } from '@/lib/utils';

// ─── Data shapes that come back from /api/portals?projectId=… ─────────
interface ApiSuite {
  id: string;
  name: string;
  _count?: { testCases: number };
}
interface ApiModule {
  id: string;
  name: string;
  suites: ApiSuite[];
}
interface ApiPortal {
  id: string;
  name: string;
  slug: string | null;
  icon: string | null;
  modules: ApiModule[];
}

interface TestCaseListProps {
  projectId: string | null;
  projectName: string;
  /** Selected suite key in the legacy "ModuleName:SuiteName" form (kept for back-compat). */
  currentKey: string;
  /** Existing useStore action — called when a suite is picked in the in-page tree. */
  onNavigate: (modName: string, featName: string) => void;
  onShowCreate: () => void;
  /** Reserved for future row click — not wired in this pass. */
  onView?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];
const TYPES: TestType[] = ['Functional', 'Regression', 'Smoke', 'Sanity', 'UI', 'API'];
const STATUSES: CaseStatus[] = ['Active', 'Draft', 'Archived'];

const PAGE_SIZE = 20;

type FilterKey = 'Priority' | 'Status' | 'Type' | 'Owner';

export function TestCaseList({
  projectId,
  projectName,
  currentKey,
  onNavigate,
  onShowCreate,
}: TestCaseListProps) {
  // ─── Tree (in-page hierarchy) ──────────────────────────────
  const [tree, setTree] = useState<ApiPortal[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedPortals, setExpandedPortals] = useState<Set<string>>(new Set());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  // Fetch tree whenever the project changes.
  const reloadTree = useCallback(async () => {
    if (!projectId) {
      setTree([]);
      return;
    }
    try {
      setTreeLoading(true);
      const data = await api.get<ApiPortal[]>(`/api/portals?projectId=${projectId}`);
      setTree(data);
    } catch (e) {
      console.error('[tree fetch]', e);
    } finally {
      setTreeLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reloadTree();
  }, [reloadTree]);

  // Derive the active suite/module/portal from the legacy "ModName:SuiteName" key.
  const [curMod, curSuite] = currentKey ? currentKey.split(':') : ['', ''];
  const activeNode = useMemo(() => {
    if (!curMod || !curSuite) return null;
    for (const p of tree) {
      for (const m of p.modules) {
        if (m.name !== curMod) continue;
        const s = m.suites.find(x => x.name === curSuite);
        if (s) return { portal: p, module: m, suite: s };
      }
    }
    return null;
  }, [tree, curMod, curSuite]);

  // Auto-expand path to the active suite on every tree refresh / selection change.
  useEffect(() => {
    if (!activeNode) return;
    setExpandedPortals(s => {
      if (s.has(activeNode.portal.id)) return s;
      const n = new Set(s);
      n.add(activeNode.portal.id);
      return n;
    });
    setExpandedModules(s => {
      if (s.has(activeNode.module.id)) return s;
      const n = new Set(s);
      n.add(activeNode.module.id);
      return n;
    });
  }, [activeNode]);

  // ─── Filters + paging ──────────────────────────────────────
  const [priorityF, setPriorityF] = useState<Set<Priority>>(new Set());
  const [statusF, setStatusF] = useState<Set<CaseStatus>>(new Set<CaseStatus>(['Active']));
  const [typeF, setTypeF] = useState<Set<TestType>>(new Set());
  const [ownerF, setOwnerF] = useState<Set<string>>(new Set());
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Close any open filter dropdown when clicking outside.
  useEffect(() => {
    if (!openFilter) return;
    const h = (e: MouseEvent) => {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target as Node))
        setOpenFilter(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [openFilter]);

  // Reset to page 1 whenever filters or suite change.
  useEffect(() => {
    setPage(1);
  }, [priorityF, statusF, typeF, ownerF, search, activeNode?.suite.id]);

  // ─── Cases (server fetch) ──────────────────────────────────
  const [cases, setCases] = useState<ApiTestCase[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [casesLoading, setCasesLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchCases = useCallback(async () => {
    if (!activeNode) {
      setCases([]);
      setTotal(0);
      setTotalPages(1);
      return;
    }
    try {
      setCasesLoading(true);
      const params = new URLSearchParams({
        suiteId: activeNode.suite.id,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sort: 'caseNum',
        order: 'asc',
      });
      priorityF.forEach(p => params.append('priority', p));
      statusF.forEach(s => params.append('status', s));
      typeF.forEach(t => params.append('type', t));
      ownerF.forEach(o => params.append('ownerId', o));
      if (search.trim()) params.set('search', search.trim());

      const data = await api.get<{
        items: ApiTestCase[];
        total: number;
        totalPages: number;
      }>(`/api/test-cases?${params.toString()}`);
      setCases(data.items);
      setTotal(data.total);
      setTotalPages(Math.max(1, data.totalPages));
    } catch (e) {
      console.error('[cases fetch]', e);
      setCases([]);
    } finally {
      setCasesLoading(false);
    }
  }, [activeNode, page, priorityF, statusF, typeF, ownerF, search]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  // ─── Users (owner filter) ──────────────────────────────────
  const [users, setUsers] = useState<UserSummary[]>([]);
  useEffect(() => {
    api
      .get<UserSummary[]>('/api/users')
      .then(setUsers)
      .catch(e => console.error('[users fetch]', e));
  }, []);
  const userById = useMemo(() => {
    const m = new Map<string, UserSummary>();
    users.forEach(u => m.set(u.id, u));
    return m;
  }, [users]);

  // ─── Tree mutation state ───────────────────────────────────
  // Tracks an in-progress create/rename. `targetId` = parent for adds, node for renames.
  type EditKind =
    | 'add-portal'
    | 'add-module'
    | 'add-suite'
    | 'rename-portal'
    | 'rename-module'
    | 'rename-suite';
  const [edit, setEdit] = useState<{
    kind: EditKind;
    targetId: string | null;
    draft: string;
  } | null>(null);

  // Copy dialog state — drives the modal that lets users clone a module or suite to another location.
  type CopyTarget =
    | { kind: 'module'; id: string; name: string; sourcePortalId: string }
    | { kind: 'suite'; id: string; name: string; sourceModuleId: string; sourcePortalId: string };
  const [copyTarget, setCopyTarget] = useState<CopyTarget | null>(null);

  // ─── Actions ───────────────────────────────────────────────
  const togglePortal = (id: string) =>
    setExpandedPortals(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleModule = (id: string) =>
    setExpandedModules(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const pickSuite = (modName: string, suiteName: string) => {
    onNavigate(modName, suiteName);
  };

  // Start an add/rename — auto-expands parents so the inline input is visible.
  const startAdd = (kind: 'add-portal' | 'add-module' | 'add-suite', targetId: string | null) => {
    if (kind === 'add-module' && targetId) {
      setExpandedPortals(s => {
        const n = new Set(s);
        n.add(targetId);
        return n;
      });
    }
    if (kind === 'add-suite' && targetId) {
      setExpandedModules(s => {
        const n = new Set(s);
        n.add(targetId);
        return n;
      });
    }
    setEdit({ kind, targetId, draft: '' });
  };
  const startRename = (
    kind: 'rename-portal' | 'rename-module' | 'rename-suite',
    targetId: string,
    currentName: string,
  ) => setEdit({ kind, targetId, draft: currentName });
  const cancelEdit = () => setEdit(null);

  const submitEdit = useCallback(async () => {
    if (!edit) return;
    const name = edit.draft.trim();
    if (!name) {
      setEdit(null);
      return;
    }
    try {
      switch (edit.kind) {
        case 'add-portal':
          if (!projectId) return;
          await api.post('/api/portals', { name, projectId });
          break;
        case 'add-module':
          if (!edit.targetId) return;
          await api.post('/api/modules', { name, portalId: edit.targetId });
          break;
        case 'add-suite': {
          if (!edit.targetId) return;
          await api.post('/api/features', { name, moduleId: edit.targetId });
          // Navigate to the newly-created suite so the user lands on it immediately.
          const mod = tree.flatMap(p => p.modules).find(m => m.id === edit.targetId);
          if (mod) onNavigate(mod.name, name);
          break;
        }
        case 'rename-portal':
          if (!edit.targetId) return;
          await api.patch(`/api/portals/${edit.targetId}`, { name });
          break;
        case 'rename-module': {
          if (!edit.targetId) return;
          await api.patch(`/api/modules/${edit.targetId}`, { name });
          // Keep currentKey in sync if we renamed the active module.
          if (activeNode?.module.id === edit.targetId) {
            onNavigate(name, activeNode.suite.name);
          }
          break;
        }
        case 'rename-suite': {
          if (!edit.targetId) return;
          await api.patch(`/api/features/${edit.targetId}`, { name });
          if (activeNode?.suite.id === edit.targetId) {
            onNavigate(activeNode.module.name, name);
          }
          break;
        }
      }
      await reloadTree();
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`);
    } finally {
      setEdit(null);
    }
  }, [edit, projectId, tree, activeNode, onNavigate, reloadTree]);

  // Delete helpers — each prompts a confirm with the cascade impact spelled out.
  const removePortal = async (portal: ApiPortal) => {
    const moduleCount = portal.modules.length;
    const suiteCount = portal.modules.reduce((sum, m) => sum + m.suites.length, 0);
    const msg =
      moduleCount > 0
        ? `Delete portal "${portal.name}" and its ${moduleCount} module${moduleCount === 1 ? '' : 's'} (${suiteCount} suite${suiteCount === 1 ? '' : 's'} + all test cases)?\n\nThis cannot be undone.`
        : `Delete portal "${portal.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await api.del(`/api/portals/${portal.id}`);
      await reloadTree();
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  };
  const removeModule = async (mod: ApiModule) => {
    const sc = mod.suites.length;
    const msg =
      sc > 0
        ? `Delete module "${mod.name}" and its ${sc} suite${sc === 1 ? '' : 's'} (and all their test cases)?\n\nThis cannot be undone.`
        : `Delete module "${mod.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await api.del(`/api/modules/${mod.id}`);
      await reloadTree();
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  };
  const removeSuite = async (suite: ApiSuite) => {
    const c = suite._count?.testCases ?? 0;
    const msg =
      c > 0
        ? `Delete suite "${suite.name}" and its ${c} test case${c === 1 ? '' : 's'}?\n\nThis cannot be undone.`
        : `Delete suite "${suite.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await api.del(`/api/features/${suite.id}`);
      await reloadTree();
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  };

  // Top-of-header "+ New suite" shortcut: adds a suite under the active module inline.
  const addSuiteUnderActive = () => {
    if (!activeNode) return;
    startAdd('add-suite', activeNode.module.id);
  };

  const clearAll = () => {
    setPriorityF(new Set());
    setStatusF(new Set());
    setTypeF(new Set());
    setOwnerF(new Set());
    setSearch('');
  };
  const activeFilterCount =
    priorityF.size + statusF.size + typeF.size + ownerF.size + (search.trim() ? 1 : 0);

  const toggleSelect = (id: string) =>
    setSelected(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleSelectAll = () => {
    if (cases.length === 0) return;
    if (selected.size === cases.length) setSelected(new Set());
    else setSelected(new Set(cases.map(c => c.id)));
  };

  // Sibling suites count for the header subtitle (e.g. "3 suites" under the same module).
  const siblingSuiteCount = activeNode?.module.suites.length ?? 0;

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Breadcrumb */}
        <div className="mb-2 flex items-center gap-1.5 text-[12px] text-text-3">
          <span className="hover:text-text">{projectName || 'Project'}</span>
          {activeNode ? (
            <>
              <Slash />
              <span className="hover:text-text">{activeNode.portal.name}</span>
              <Slash />
              <span className="hover:text-text">{activeNode.module.name}</span>
              <Slash />
              <span className="font-medium text-text">{activeNode.suite.name}</span>
            </>
          ) : (
            <>
              <Slash />
              <span className="text-text-3">Pick a suite</span>
            </>
          )}
        </div>

        {/* Header strip */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">
              {activeNode?.suite.name ?? 'Test cases'}
            </h1>
            <p className="text-[13px] text-text-2">
              {activeNode ? (
                <>
                  {total} test case{total === 1 ? '' : 's'}
                  {siblingSuiteCount > 0 && (
                    <>
                      <span className="mx-1.5 text-text-3">·</span>
                      {siblingSuiteCount} suite{siblingSuiteCount === 1 ? '' : 's'} in module
                    </>
                  )}
                </>
              ) : (
                'Pick a suite from the hierarchy to view its test cases.'
              )}
            </p>
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <button
              type="button"
              onClick={addSuiteUnderActive}
              disabled={!activeNode}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-[7px] text-[13px] text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                activeNode ? `Add suite under ${activeNode.module.name}` : 'Pick a suite first'
              }
            >
              <i className="ti ti-folder-plus text-[16px]" />
              New suite
            </button>
            <button
              type="button"
              onClick={onShowCreate}
              disabled={!activeNode}
              className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-[7px] text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className="ti ti-plus text-[16px]" />
              New case
            </button>
          </div>
        </div>

        {/* Two-column body */}
        <div className="flex items-start gap-6">
          {/* Hierarchy column */}
          <aside className="w-[260px] flex-shrink-0 rounded-lg border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-text-3">
                Hierarchy
              </span>
              <button
                type="button"
                title="Add portal"
                onClick={() => startAdd('add-portal', null)}
                disabled={!projectId}
                className="rounded p-0.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <i className="ti ti-plus text-[14px]" />
              </button>
            </div>
            <div className="max-h-[640px] overflow-y-auto px-1 py-1.5 text-[13px]">
              {treeLoading && tree.length === 0 && (
                <p className="px-3 py-2 text-[12px] italic text-text-3">Loading…</p>
              )}
              {!treeLoading && tree.length === 0 && !edit && (
                <p className="px-3 py-2 text-[12px] italic text-text-3">
                  No portals yet — click + above to add one.
                </p>
              )}

              {/* Inline "add portal" input lives at the very top of the tree. */}
              {edit?.kind === 'add-portal' && (
                <InlineRow
                  indent={0}
                  icon="ti-app-window"
                  placeholder="Portal name…"
                  draft={edit.draft}
                  setDraft={v => setEdit(e => (e ? { ...e, draft: v } : e))}
                  onSubmit={submitEdit}
                  onCancel={cancelEdit}
                />
              )}

              {tree.map(portal => {
                const pOpen = expandedPortals.has(portal.id);
                const isRenamingPortal =
                  edit?.kind === 'rename-portal' && edit.targetId === portal.id;
                return (
                  <div key={portal.id} className="mb-0.5">
                    {/* Portal row */}
                    <NodeRow
                      indent={0}
                      isActive={false}
                      isRenaming={isRenamingPortal}
                      onLabelClick={() => togglePortal(portal.id)}
                      chevron={<Chevron open={pOpen} />}
                      icon={<PortalGlyph icon={portal.icon} />}
                      label={portal.name}
                      bold
                      renameDraft={isRenamingPortal ? edit!.draft : ''}
                      onRenameChange={v => setEdit(e => (e ? { ...e, draft: v } : e))}
                      onRenameSubmit={submitEdit}
                      onRenameCancel={cancelEdit}
                      actions={
                        <>
                          <NodeAction
                            icon="ti-plus"
                            title="Add module"
                            onClick={() => startAdd('add-module', portal.id)}
                          />
                          <NodeAction
                            icon="ti-pencil"
                            title="Rename portal"
                            onClick={() => startRename('rename-portal', portal.id, portal.name)}
                          />
                          <NodeAction
                            icon="ti-trash"
                            title="Delete portal"
                            danger
                            onClick={() => removePortal(portal)}
                          />
                        </>
                      }
                    />

                    {pOpen && (
                      <>
                        {portal.modules.map(mod => {
                          const mOpen = expandedModules.has(mod.id);
                          const isRenamingModule =
                            edit?.kind === 'rename-module' && edit.targetId === mod.id;
                          return (
                            <div key={mod.id} className="ml-3">
                              <NodeRow
                                indent={1}
                                isActive={false}
                                isRenaming={isRenamingModule}
                                onLabelClick={() => toggleModule(mod.id)}
                                chevron={<Chevron open={mOpen} />}
                                icon={<i className="ti ti-folder text-[14px] text-text-3" />}
                                label={mod.name}
                                renameDraft={isRenamingModule ? edit!.draft : ''}
                                onRenameChange={v => setEdit(e => (e ? { ...e, draft: v } : e))}
                                onRenameSubmit={submitEdit}
                                onRenameCancel={cancelEdit}
                                actions={
                                  <>
                                    <NodeAction
                                      icon="ti-plus"
                                      title="Add suite"
                                      onClick={() => startAdd('add-suite', mod.id)}
                                    />
                                    <NodeAction
                                      icon="ti-copy"
                                      title="Copy module to another portal"
                                      onClick={() =>
                                        setCopyTarget({
                                          kind: 'module',
                                          id: mod.id,
                                          name: mod.name,
                                          sourcePortalId: portal.id,
                                        })
                                      }
                                    />
                                    <NodeAction
                                      icon="ti-pencil"
                                      title="Rename module"
                                      onClick={() => startRename('rename-module', mod.id, mod.name)}
                                    />
                                    <NodeAction
                                      icon="ti-trash"
                                      title="Delete module"
                                      danger
                                      onClick={() => removeModule(mod)}
                                    />
                                  </>
                                }
                              />

                              {mOpen && (
                                <div className="ml-4 border-l border-border pl-1">
                                  {mod.suites.length === 0 &&
                                    !(edit?.kind === 'add-suite' && edit.targetId === mod.id) && (
                                      <p className="px-2 py-1 text-[11px] italic text-text-3">
                                        No suites yet
                                      </p>
                                    )}
                                  {mod.suites.map(suite => {
                                    const active =
                                      activeNode?.suite.id === suite.id &&
                                      activeNode?.module.id === mod.id;
                                    const isRenamingSuite =
                                      edit?.kind === 'rename-suite' && edit.targetId === suite.id;
                                    return (
                                      <NodeRow
                                        key={suite.id}
                                        indent={2}
                                        isActive={active}
                                        isRenaming={isRenamingSuite}
                                        onLabelClick={() => pickSuite(mod.name, suite.name)}
                                        icon={
                                          <span
                                            className={cn(
                                              'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                                              active ? 'bg-primary' : 'bg-text-3/40',
                                            )}
                                          />
                                        }
                                        label={suite.name}
                                        suffix={
                                          suite._count && suite._count.testCases > 0 ? (
                                            <span
                                              className={cn(
                                                'ml-1 rounded-full px-1.5 py-px text-[10px]',
                                                active
                                                  ? 'bg-primary/20 text-primary-text'
                                                  : 'bg-surface-2 text-text-3',
                                              )}
                                            >
                                              {suite._count.testCases}
                                            </span>
                                          ) : null
                                        }
                                        renameDraft={isRenamingSuite ? edit!.draft : ''}
                                        onRenameChange={v =>
                                          setEdit(e => (e ? { ...e, draft: v } : e))
                                        }
                                        onRenameSubmit={submitEdit}
                                        onRenameCancel={cancelEdit}
                                        actions={
                                          <>
                                            <NodeAction
                                              icon="ti-copy"
                                              title="Copy suite to another module"
                                              onClick={() =>
                                                setCopyTarget({
                                                  kind: 'suite',
                                                  id: suite.id,
                                                  name: suite.name,
                                                  sourceModuleId: mod.id,
                                                  sourcePortalId: portal.id,
                                                })
                                              }
                                            />
                                            <NodeAction
                                              icon="ti-pencil"
                                              title="Rename suite"
                                              onClick={() =>
                                                startRename('rename-suite', suite.id, suite.name)
                                              }
                                            />
                                            <NodeAction
                                              icon="ti-trash"
                                              title="Delete suite"
                                              danger
                                              onClick={() => removeSuite(suite)}
                                            />
                                          </>
                                        }
                                      />
                                    );
                                  })}

                                  {/* Inline "add suite" input at the bottom of the module. */}
                                  {edit?.kind === 'add-suite' && edit.targetId === mod.id && (
                                    <InlineRow
                                      indent={2}
                                      placeholder="Suite name…"
                                      draft={edit.draft}
                                      setDraft={v => setEdit(e => (e ? { ...e, draft: v } : e))}
                                      onSubmit={submitEdit}
                                      onCancel={cancelEdit}
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Inline "add module" input at the bottom of the portal. */}
                        {edit?.kind === 'add-module' && edit.targetId === portal.id && (
                          <div className="ml-3">
                            <InlineRow
                              indent={1}
                              icon="ti-folder"
                              placeholder="Module name…"
                              draft={edit.draft}
                              setDraft={v => setEdit(e => (e ? { ...e, draft: v } : e))}
                              onSubmit={submitEdit}
                              onCancel={cancelEdit}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {/* Hint when no portals AND user is mid-create */}
              {tree.length === 0 && edit?.kind === 'add-portal' && (
                <p className="px-3 py-2 text-[10px] italic text-text-3">
                  Tip: Enter to save, Esc to cancel.
                </p>
              )}
            </div>
          </aside>

          {/* Right pane (filters + table) */}
          <section className="min-w-0 flex-1">
            {/* Filter chips */}
            <div ref={filterBarRef} className="mb-4 flex flex-wrap items-center gap-2">
              <FilterChip
                label="Priority"
                icon="ti-flag"
                options={PRIORITIES}
                selected={priorityF}
                onToggle={v => {
                  const n = new Set(priorityF);
                  n.has(v) ? n.delete(v) : n.add(v);
                  setPriorityF(n);
                }}
                onClear={() => setPriorityF(new Set())}
                isOpen={openFilter === 'Priority'}
                onOpen={() => setOpenFilter(openFilter === 'Priority' ? null : 'Priority')}
              />
              <FilterChip
                label="Status"
                icon="ti-circle-dot"
                options={STATUSES}
                selected={statusF}
                onToggle={v => {
                  const n = new Set(statusF);
                  n.has(v) ? n.delete(v) : n.add(v);
                  setStatusF(n);
                }}
                onClear={() => setStatusF(new Set())}
                isOpen={openFilter === 'Status'}
                onOpen={() => setOpenFilter(openFilter === 'Status' ? null : 'Status')}
              />
              <FilterChip
                label="Type"
                icon="ti-category"
                options={TYPES}
                selected={typeF}
                onToggle={v => {
                  const n = new Set(typeF);
                  n.has(v) ? n.delete(v) : n.add(v);
                  setTypeF(n);
                }}
                onClear={() => setTypeF(new Set())}
                isOpen={openFilter === 'Type'}
                onOpen={() => setOpenFilter(openFilter === 'Type' ? null : 'Type')}
              />
              <OwnerFilterChip
                users={users}
                selected={ownerF}
                onToggle={uid => {
                  const n = new Set(ownerF);
                  n.has(uid) ? n.delete(uid) : n.add(uid);
                  setOwnerF(n);
                }}
                onClear={() => setOwnerF(new Set())}
                isOpen={openFilter === 'Owner'}
                onOpen={() => setOpenFilter(openFilter === 'Owner' ? null : 'Owner')}
              />

              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-[7px] border border-dashed border-border px-2.5 py-1 text-[12px] text-text-3 hover:bg-surface-2"
                disabled
                title="More filters coming soon"
              >
                <i className="ti ti-plus text-[13px]" />
                Add filter
              </button>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded-[7px] px-2.5 py-1 text-[12px] text-text-2 hover:bg-surface-2"
                >
                  Clear all
                </button>
              )}

              <div className="relative ml-auto w-[220px]">
                <i className="ti ti-search pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-text-3" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search in suite…"
                  className="w-full rounded-[7px] border border-border bg-surface py-1.5 pl-8 pr-3 text-[12px] text-text outline-none placeholder:text-text-3 focus:border-primary focus:ring-[3px] focus:ring-primary-light"
                />
              </div>
            </div>

            {/* Table card */}
            {!activeNode ? (
              <EmptyState
                icon="ti-pointer"
                title="Pick a suite"
                body="Use the hierarchy on the left to drill down to a suite."
              />
            ) : casesLoading && cases.length === 0 ? (
              <EmptyState icon="ti-loader-2" title="Loading…" body="" spin />
            ) : cases.length === 0 ? (
              <EmptyState
                icon="ti-clipboard-list"
                title="No test cases match"
                body={
                  activeFilterCount > 0
                    ? 'Try widening or clearing your filters.'
                    : 'Click "New case" to create the first one.'
                }
              />
            ) : (
              <>
                <div className="overflow-hidden rounded-lg border border-border bg-surface">
                  <table className="w-full border-collapse text-[13px]">
                    <thead className="bg-surface-2">
                      <tr>
                        <th className="w-[36px] border-b border-border px-4 py-2.5 text-left">
                          <CheckBox
                            checked={cases.length > 0 && selected.size === cases.length}
                            onChange={toggleSelectAll}
                          />
                        </th>
                        <Th>ID</Th>
                        <Th>Title</Th>
                        <Th width="100px">Priority</Th>
                        <Th width="120px">Type</Th>
                        <Th width="100px">Status</Th>
                        <Th width="80px">Owner</Th>
                        <th className="w-[60px] border-b border-border px-2 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {cases.map(tc => {
                        const isSel = selected.has(tc.id);
                        const owner = tc.ownerId
                          ? (userById.get(tc.ownerId) ?? tc.owner ?? null)
                          : null;
                        return (
                          <tr
                            key={tc.id}
                            className={cn(
                              'group border-b border-border transition-colors last:border-b-0',
                              isSel ? 'bg-primary-light/60' : 'hover:bg-surface-2',
                            )}
                          >
                            <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                              <CheckBox checked={isSel} onChange={() => toggleSelect(tc.id)} />
                            </td>
                            <td className="px-4 py-3 font-mono text-[12px] text-text-3">
                              TC-{String(tc.caseNum).padStart(2, '0')}
                            </td>
                            <td className="px-4 py-3">
                              <TruncatedText text={tc.title} className="text-text" />
                              {tc.sub && (
                                <TruncatedText
                                  text={tc.sub}
                                  className="mt-0.5 text-[12px] text-text-3"
                                />
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <Pill className={priorityBadge(tc.priority)}>{tc.priority}</Pill>
                            </td>
                            <td className="px-4 py-3">
                              <Pill className={typeBadge(tc.type)}>{tc.type}</Pill>
                            </td>
                            <td className="px-4 py-3">
                              <Pill className={cn(statusBadge(tc.status), 'ring-1')}>
                                {tc.status}
                              </Pill>
                            </td>
                            <td className="px-4 py-3">
                              <OwnerAvatar user={owner} />
                            </td>
                            <td className="px-2 py-3 text-right">
                              <button
                                type="button"
                                title="Actions"
                                className="invisible rounded p-1 text-text-3 transition-colors hover:bg-surface-3 hover:text-text group-hover:visible"
                              >
                                <i className="ti ti-dots-vertical text-[14px]" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer / pagination */}
                <div className="mt-3 flex items-center justify-between px-1 text-[12px] text-text-3">
                  <span>
                    Showing {cases.length} of {total} case{total === 1 ? '' : 's'}
                    {selected.size > 0 && (
                      <>
                        <span className="mx-2 text-text-3">·</span>
                        <span className="font-medium text-primary">{selected.size} selected</span>
                      </>
                    )}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="rounded p-1 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <i className="ti ti-chevron-left text-[14px]" />
                    </button>
                    <span className="px-1">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="rounded p-1 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <i className="ti ti-chevron-right text-[14px]" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {/* Copy module / suite dialog */}
      {copyTarget && (
        <CopyDialog
          target={copyTarget}
          tree={tree}
          onClose={() => setCopyTarget(null)}
          onCopied={async () => {
            setCopyTarget(null);
            await reloadTree();
          }}
        />
      )}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────

function Slash() {
  return <span className="text-text-3">/</span>;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <i
      className={cn(
        'ti ti-chevron-right text-[12px] text-text-3 transition-transform',
        open && 'rotate-90',
      )}
    />
  );
}

function PortalGlyph({ icon }: { icon: string | null }) {
  if (icon && icon.startsWith('ti-')) {
    return <i className={cn('ti', icon, 'text-[14px] text-text-3')} />;
  }
  return <i className="ti ti-app-window text-[14px] text-text-3" />;
}

// ─── Hierarchy node row ────────────────────────────────────
// Renders one portal/module/suite line, with hover-revealed action buttons and
// an inline rename input when isRenaming is true.

interface NodeRowProps {
  indent: number; // 0 = portal, 1 = module, 2 = suite
  isActive: boolean;
  isRenaming: boolean;
  chevron?: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  suffix?: React.ReactNode;
  bold?: boolean;
  onLabelClick: () => void;
  actions: React.ReactNode;
  renameDraft: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}

function NodeRow({
  indent,
  isActive,
  isRenaming,
  chevron,
  icon,
  label,
  suffix,
  bold,
  onLabelClick,
  actions,
  renameDraft,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: NodeRowProps) {
  const textSize = indent === 2 ? 'text-[12.5px]' : 'text-[13px]';
  const baseColor = indent === 0 ? 'text-text' : indent === 1 ? 'text-text-2' : 'text-text-2';
  return (
    <div
      className={cn(
        'group/node flex items-center rounded-md transition-colors',
        isActive ? 'bg-primary-light' : 'hover:bg-surface-2',
      )}
    >
      {isRenaming ? (
        <div className="flex flex-1 items-center gap-1.5 px-2 py-0.5">
          {chevron ?? <span className="inline-block w-3" />}
          {icon}
          <input
            autoFocus
            value={renameDraft}
            onChange={e => onRenameChange(e.target.value)}
            onBlur={onRenameSubmit}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onRenameSubmit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onRenameCancel();
              }
            }}
            className="min-w-0 flex-1 rounded border border-primary bg-surface px-1.5 py-0.5 text-[12.5px] text-text outline-none focus:ring-2 focus:ring-primary-light"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onLabelClick}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left',
            textSize,
            bold ? 'font-medium' : '',
            isActive ? 'font-semibold text-primary-text' : baseColor,
          )}
        >
          {chevron ?? <span className="inline-block w-3" />}
          {icon}
          <span className="flex-1 truncate">{label}</span>
          {suffix}
        </button>
      )}

      {!isRenaming && (
        <div className="mr-1 flex items-center opacity-0 transition-opacity group-hover/node:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}

// Small icon button used inside the hover action area.
function NodeAction({
  icon,
  title,
  onClick,
  danger,
}: {
  icon: string;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'rounded p-1 text-text-3 transition-colors',
        danger ? 'hover:bg-danger-bg hover:text-danger' : 'hover:bg-surface-3 hover:text-text',
      )}
    >
      <i className={cn('ti', icon, 'text-[12px]')} />
    </button>
  );
}

// Inline input row used when creating a new portal / module / suite.
function InlineRow({
  indent,
  icon,
  placeholder,
  draft,
  setDraft,
  onSubmit,
  onCancel,
}: {
  indent: number;
  icon?: string;
  placeholder: string;
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const textSize = indent === 2 ? 'text-[12.5px]' : 'text-[13px]';
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-primary-light/40 px-2 py-1">
      <span className="inline-block w-3" />
      {icon ? (
        <i className={cn('ti', icon, 'text-[14px] text-primary')} />
      ) : (
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
      )}
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={placeholder}
        onBlur={onSubmit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className={cn(
          'min-w-0 flex-1 rounded border border-primary bg-surface px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-primary-light',
          textSize,
        )}
      />
    </div>
  );
}

function Th({ children, width }: { children: React.ReactNode; width?: string }) {
  return (
    <th
      style={width ? { width } : undefined}
      className="border-b border-border px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-text-3"
    >
      {children}
    </th>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-[1.5]',
        className,
      )}
    >
      {children}
    </span>
  );
}

function CheckBox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        'relative inline-block h-3.5 w-3.5 flex-shrink-0 rounded-[4px] border-[1.5px] align-middle transition-all',
        checked
          ? 'border-primary bg-primary'
          : 'border-border-strong bg-surface hover:border-primary',
      )}
    >
      {checked && (
        <span
          className="absolute left-[3px] top-[0.5px] h-2 w-1 rotate-45 border-solid border-white"
          style={{ borderWidth: '0 2px 2px 0' }}
        />
      )}
    </button>
  );
}

function OwnerAvatar({ user }: { user: UserSummary | null | undefined }) {
  if (!user) {
    return (
      <span
        title="Unassigned"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border-strong text-[10px] text-text-3"
      >
        —
      </span>
    );
  }
  const label = user.name || user.username || user.email || '?';
  return (
    <span
      title={`${label} (${user.email})`}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold',
        avatarColour(user.id),
      )}
    >
      {initials(label)}
    </span>
  );
}

function EmptyState({
  icon,
  title,
  body,
  spin,
}: {
  icon: string;
  title: string;
  body: string;
  spin?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface py-20 text-text-3">
      <i className={cn('ti', icon, 'text-[36px] opacity-50', spin && 'animate-spin')} />
      <p className="text-[14px] font-medium text-text-2">{title}</p>
      {body && <p className="max-w-[260px] text-center text-[12px]">{body}</p>}
    </div>
  );
}

// ─── Generic filter chip ─────────────────────────────────────

interface FilterChipProps<T extends string> {
  label: string;
  icon: string;
  options: T[];
  selected: Set<T>;
  onToggle: (value: T) => void;
  onClear: () => void;
  isOpen: boolean;
  onOpen: () => void;
}

function FilterChip<T extends string>({
  label,
  icon,
  options,
  selected,
  onToggle,
  onClear,
  isOpen,
  onOpen,
}: FilterChipProps<T>) {
  const count = selected.size;
  // Render the single-value selection inline (e.g. "Status: Active") to match the design.
  const singleLabel = count === 1 ? Array.from(selected)[0] : null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-[12px] transition-colors',
          count > 0
            ? 'border-primary bg-primary-light font-medium text-primary-text'
            : 'border-border bg-surface text-text-2 hover:bg-surface-2',
        )}
      >
        <i className={cn('ti', icon, 'text-[13px]')} />
        {singleLabel ? `${label}: ${singleLabel}` : label}
        {count > 1 && (
          <span className="ml-0.5 rounded-full bg-primary px-1.5 py-px font-mono text-[10px] text-white">
            {count}
          </span>
        )}
        {count > 0 ? (
          <i
            role="button"
            onClick={e => {
              e.stopPropagation();
              onClear();
            }}
            className="ti ti-x ml-0.5 text-[12px] hover:text-text"
          />
        ) : (
          <i className={cn('ti ti-chevron-down text-[12px]')} />
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-[180px] rounded-lg border border-border bg-surface py-1.5 shadow-[0_4px_24px_-4px_rgba(28,25,23,0.12)]">
          {options.map(opt => {
            const checked = selected.has(opt);
            return (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-2"
              >
                <CheckBox checked={checked} onChange={() => onToggle(opt)} />
                <span className="text-text">{opt}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Owner filter (uses user list, not enum) ─────────────────

function OwnerFilterChip({
  users,
  selected,
  onToggle,
  onClear,
  isOpen,
  onOpen,
}: {
  users: UserSummary[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  isOpen: boolean;
  onOpen: () => void;
}) {
  const count = selected.size;
  const singleUser = count === 1 ? users.find(u => u.id === Array.from(selected)[0]) : null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-[12px] transition-colors',
          count > 0
            ? 'border-primary bg-primary-light font-medium text-primary-text'
            : 'border-border bg-surface text-text-2 hover:bg-surface-2',
        )}
      >
        <i className="ti ti-user text-[13px]" />
        {singleUser ? `Owner: ${singleUser.name || singleUser.username}` : 'Owner'}
        {count > 1 && (
          <span className="ml-0.5 rounded-full bg-primary px-1.5 py-px font-mono text-[10px] text-white">
            {count}
          </span>
        )}
        {count > 0 ? (
          <i
            role="button"
            onClick={e => {
              e.stopPropagation();
              onClear();
            }}
            className="ti ti-x ml-0.5 text-[12px] hover:text-text"
          />
        ) : (
          <i className="ti ti-chevron-down text-[12px]" />
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-30 max-h-[260px] w-[220px] overflow-auto rounded-lg border border-border bg-surface py-1.5 shadow-[0_4px_24px_-4px_rgba(28,25,23,0.12)]">
          {users.length === 0 && (
            <p className="px-3 py-2 text-[12px] italic text-text-3">No users yet</p>
          )}
          {users.map(u => {
            const checked = selected.has(u.id);
            const label = u.name || u.username;
            return (
              <label
                key={u.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-2"
              >
                <CheckBox checked={checked} onChange={() => onToggle(u.id)} />
                <span
                  className={cn(
                    'inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-semibold',
                    avatarColour(u.id),
                  )}
                >
                  {initials(label)}
                </span>
                <span className="truncate text-text">{label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Copy module / suite dialog ──────────────────────────────

interface CopyDialogProps {
  target:
    | { kind: 'module'; id: string; name: string; sourcePortalId: string }
    | {
        kind: 'suite';
        id: string;
        name: string;
        sourceModuleId: string;
        sourcePortalId: string;
      };
  tree: ApiPortal[];
  onClose: () => void;
  onCopied: () => void;
}

function CopyDialog({ target, tree, onClose, onCopied }: CopyDialogProps) {
  // Module copy needs a portal destination; suite copy needs a portal + module destination.
  const [portalId, setPortalId] = useState<string>(target.sourcePortalId);
  const [moduleId, setModuleId] = useState<string>(
    target.kind === 'suite' ? target.sourceModuleId : '',
  );
  const [name, setName] = useState<string>(target.name);
  const [includeCases, setIncludeCases] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep destination module valid as user switches portals.
  const modulesInPortal = useMemo(() => {
    const portal = tree.find(p => p.id === portalId);
    return portal?.modules ?? [];
  }, [tree, portalId]);

  useEffect(() => {
    if (target.kind !== 'suite') return;
    if (modulesInPortal.length === 0) {
      setModuleId('');
      return;
    }
    if (!modulesInPortal.some(m => m.id === moduleId)) {
      setModuleId(modulesInPortal[0].id);
    }
  }, [modulesInPortal, moduleId, target.kind]);

  const submit = async () => {
    if (busy) return;
    setErr(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErr('Name cannot be empty');
      return;
    }
    try {
      setBusy(true);
      if (target.kind === 'module') {
        if (!portalId) {
          setErr('Pick a destination portal');
          return;
        }
        await api.post(`/api/modules/${target.id}/copy`, {
          portalId,
          name: trimmedName,
          includeTestCases: includeCases,
        });
      } else {
        if (!moduleId) {
          setErr('Pick a destination module');
          return;
        }
        await api.post(`/api/features/${target.id}/copy`, {
          moduleId,
          name: trimmedName,
          includeTestCases: includeCases,
        });
      }
      onCopied();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-lg border border-border bg-surface shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)]"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h3 className="text-[14px] font-semibold text-text">
              Copy {target.kind === 'module' ? 'module' : 'suite'}
            </h3>
            <p className="mt-0.5 text-[12px] text-text-3">
              Source: <span className="font-mono text-text-2">{target.name}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-3 hover:bg-surface-2 hover:text-text"
            title="Close"
          >
            <i className="ti ti-x text-[16px]" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {/* Destination portal */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
              Destination portal
            </label>
            <select
              value={portalId}
              onChange={e => setPortalId(e.target.value)}
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
            >
              {tree.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === target.sourcePortalId ? ' (same portal)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Destination module (suites only) */}
          {target.kind === 'suite' && (
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
                Destination module
              </label>
              {modulesInPortal.length === 0 ? (
                <p className="rounded border border-dashed border-border bg-surface-2 px-2 py-2 text-[12px] italic text-text-3">
                  This portal has no modules — add one first.
                </p>
              ) : (
                <select
                  value={moduleId}
                  onChange={e => setModuleId(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                >
                  {modulesInPortal.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.id === target.sourceModuleId ? ' (same module)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* New name */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
              New name
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
            />
            <p className="mt-1 text-[11px] text-text-3">
              If a {target.kind} with this name already exists at the destination,
              &nbsp;&ldquo;(copy)&rdquo; will be appended.
            </p>
          </div>

          {/* Include test cases? */}
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-surface-2/40 p-2.5">
            <input
              type="checkbox"
              checked={includeCases}
              onChange={e => setIncludeCases(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-primary"
            />
            <span className="text-[12.5px]">
              <span className="font-medium text-text">Include test cases</span>
              <span className="block text-[11px] text-text-3">
                Off = copy the folder structure only. On = clone every test case under it.
              </span>
            </span>
          </label>

          {err && (
            <div className="rounded border border-danger/30 bg-danger-bg px-2.5 py-1.5 text-[12px] text-danger-text">
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || (target.kind === 'suite' && !moduleId)}
            className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
            <i className="ti ti-copy text-[13px]" />
            Copy {target.kind}
          </button>
        </div>
      </div>
    </div>
  );
}
