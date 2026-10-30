'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiTestCase, UserSummary } from '@/types';
import { api } from '@/lib/client';
import { exportApiTestCases } from '@/lib/export';
import { ImportCsvModal } from '@/components/features/ImportCsvModal';
import { AiGeneratePanel } from '@/components/features/AiGeneratePanel';
import { AiImproveFolderPanel } from '@/components/features/AiImproveFolderPanel';
import { TestCaseForm, TestCaseFormValues } from '@/components/features/TestCaseForm';
import { useCaseOptions, CaseOption } from '@/components/features/CaseClassification';
import { Ico } from '@/components/features/tc-icons';
import {
  caseHref,
  folderHref,
  folderUrl,
  clearInitialFolder,
  peekInitialFolder,
} from '@/lib/caseLink';
import {
  avatarGradient,
  caseCode,
  optionPillClass,
  priorityPillClass,
  resultPillClass,
  statusPillClass,
  typePillClass,
} from '@/components/features/tc-helpers';
import { cn, initials, priorityToneDisplay, typeDisplay } from '@/lib/utils';
import './testcase-v3.css';

// ─── Data shapes that come back from /api/portals?projectId=… ─────────
interface ApiSuite {
  id: string;
  name: string;
  parentId: string | null;
  // Recursive — populated by the API after flat-to-tree nesting.
  children: ApiSuite[];
  _count?: { testCases: number };
}
interface ApiModule {
  id: string;
  name: string;
  suites: ApiSuite[]; // top-level suites under this module (each may have children)
  _count?: { testCases: number };
}
interface ApiPortal {
  id: string;
  name: string;
  slug: string | null;
  icon: string | null;
  modules: ApiModule[];
  _count?: { testCases: number };
}

// Tri-level selection: a portal, a module, or a (nested) suite.
type ActiveSelection =
  | { kind: 'portal'; portal: ApiPortal }
  | { kind: 'module'; portal: ApiPortal; module: ApiModule }
  | { kind: 'suite'; portal: ApiPortal; module: ApiModule; suite: ApiSuite };

// ─── Drag-and-drop reordering ──────────────────────────────────
// One shared drag state serves every reorderable list on the page (portals,
// each module's suites, each suite's children, the test case table) — a
// `listKey` scopes drag-over/drop so dragging in one list never affects a
// different one. Kept as plain state + a plain (non-hook) handler factory so
// it can be called from `renderSuiteNode`, which isn't itself a component.
interface DragState {
  listKey: string;
  id: string;
  overId: string | null;
}
interface DragHandlers {
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isDragOver: boolean;
  isDragging: boolean;
}

interface TestCaseListProps {
  projectId: string | null;
  projectName: string;
  /** Selected suite key in the legacy "ModuleName:SuiteName" form (kept for back-compat). */
  currentKey: string;
  /** Existing useStore action — called when a suite is picked in the in-page tree. */
  onNavigate: (modName: string, featName: string) => void;
  /** Current user's display name — recorded as the author on cases created here. */
  authorName: string;
  /** Row click — opens the detail screen. Receives the clicked case and the current page list. */
  onOpenCase: (apiCase: ApiTestCase, list: ApiTestCase[]) => void;
  /** Bumped by useStore on create/edit/delete — triggers list re-fetch. */
  dataVersion?: number;
}

const MODAL_SELECT_CLS =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

// "All" is a soft cap that matches the API's hard limit (5000).
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 5000] as const;
const DEFAULT_PAGE_SIZE = 50;
const ALL_PAGE_SIZE = 5000;

type FilterKey = 'Status' | 'Priority' | 'Type';

const STATUS_OPTIONS = [
  { value: 'Active', label: 'Active' },
  { value: 'Draft', label: 'Draft' },
  { value: 'Archived', label: 'Archived' },
];

export function TestCaseList({
  projectId,
  projectName,
  currentKey,
  onNavigate,
  authorName,
  onOpenCase,
  dataVersion = 0,
}: TestCaseListProps) {
  // Workspace's Priority/Severity/Test Type options -- built-ins + any
  // custom ones added in Settings > Test Configuration (see lib/options.ts).
  // Drives the filter chips, the bulk-edit dropdown, and badge colors.
  const caseOptions = useCaseOptions(projectId ?? '');

  // ─── Tree (in-page hierarchy) ──────────────────────────────
  const [tree, setTree] = useState<ApiPortal[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedPortals, setExpandedPortals] = useState<Set<string>>(new Set());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  // For arbitrarily-deep nested suites — each toggle stores the suite id.
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());

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

  // ─── Drag-and-drop reordering ──────────────────────────────
  const [drag, setDrag] = useState<DragState | null>(null);

  // Factory (not a hook) — safe to call from renderSuiteNode, which is a
  // plain recursive function, not its own component.
  const dragHandlersFor = (
    listKey: string,
    id: string,
    ids: string[],
    onReorder: (newIds: string[]) => void,
  ): DragHandlers => ({
    onDragStart: e => {
      e.dataTransfer.effectAllowed = 'move';
      setDrag({ listKey, id, overId: null });
    },
    onDragOver: e => {
      if (!drag || drag.listKey !== listKey || drag.id === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (drag.overId !== id) setDrag({ ...drag, overId: id });
    },
    onDrop: e => {
      e.preventDefault();
      if (!drag || drag.listKey !== listKey || drag.id === id) {
        setDrag(null);
        return;
      }
      const from = ids.indexOf(drag.id);
      const to = ids.indexOf(id);
      setDrag(null);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...ids];
      next.splice(from, 1);
      next.splice(to, 0, drag.id);
      onReorder(next);
    },
    onDragEnd: () => setDrag(null),
    isDragOver: drag?.listKey === listKey && drag.overId === id && drag.id !== id,
    isDragging: drag?.listKey === listKey && drag.id === id,
  });

  const updateSuiteChildrenOrder = (
    suites: ApiSuite[],
    parentId: string,
    newIds: string[],
  ): ApiSuite[] =>
    suites.map(s =>
      s.id === parentId
        ? { ...s, children: newIds.map(id => s.children.find(c => c.id === id)!) }
        : { ...s, children: updateSuiteChildrenOrder(s.children, parentId, newIds) },
    );

  const reorderPortals = (newIds: string[]) => {
    setTree(prev => newIds.map(id => prev.find(p => p.id === id)!));
    if (!projectId) return;
    api.patch('/api/portals/reorder', { projectId, ids: newIds }).catch(() => reloadTree());
  };

  const reorderModules = (portalId: string, newIds: string[]) => {
    setTree(prev =>
      prev.map(p =>
        p.id !== portalId
          ? p
          : { ...p, modules: newIds.map(id => p.modules.find(m => m.id === id)!) },
      ),
    );
    api.patch('/api/modules/reorder', { portalId, ids: newIds }).catch(() => reloadTree());
  };

  const reorderSuites = (
    portalId: string,
    moduleId: string,
    parentId: string | null,
    newIds: string[],
  ) => {
    setTree(prev =>
      prev.map(p => {
        if (p.id !== portalId) return p;
        return {
          ...p,
          modules: p.modules.map(m => {
            if (m.id !== moduleId) return m;
            if (parentId === null) {
              return { ...m, suites: newIds.map(id => m.suites.find(s => s.id === id)!) };
            }
            return { ...m, suites: updateSuiteChildrenOrder(m.suites, parentId, newIds) };
          }),
        };
      }),
    );
    api
      .patch('/api/features/reorder', { moduleId, parentId, ids: newIds })
      .catch(() => reloadTree());
  };

  const reorderCases = (newIds: string[]) => {
    setCases(prev => newIds.map(id => prev.find(c => c.id === id)!));
    api.post('/api/test-cases/bulk', { action: 'reorder', ids: newIds }).catch(() => fetchCases());
  };

  // Elevated selection — used when the user picks a portal or module directly,
  // without drilling into a suite. Resets whenever currentKey changes (a suite
  // click in the tree always supersedes a higher-level selection).
  const [elevated, setElevated] = useState<
    | { kind: 'portal'; portalId: string }
    | { kind: 'module'; portalId: string; moduleId: string }
    | null
  >(null);

  // Derive the active selection: prefer the elevated portal/module pick,
  // otherwise fall back to the legacy "ModName:SuiteName" suite key.
  const [curMod, curSuite] = currentKey ? currentKey.split(':') : ['', ''];
  const activeNode = useMemo<ActiveSelection | null>(() => {
    if (elevated) {
      const portal = tree.find(p => p.id === elevated.portalId);
      if (!portal) return null;
      if (elevated.kind === 'portal') return { kind: 'portal', portal };
      const mod = portal.modules.find(m => m.id === elevated.moduleId);
      if (!mod) return null;
      return { kind: 'module', portal, module: mod };
    }
    if (!curMod || !curSuite) return null;
    // Walk recursively into nested suites — currentKey carries the LEAF suite
    // name, so we descend depth-first looking for a name match within the module.
    const findInSuites = (suites: ApiSuite[]): ApiSuite | null => {
      for (const s of suites) {
        if (s.name === curSuite) return s;
        const inChild = findInSuites(s.children);
        if (inChild) return inChild;
      }
      return null;
    };
    for (const p of tree) {
      for (const m of p.modules) {
        if (m.name !== curMod) continue;
        const s = findInSuites(m.suites);
        if (s) return { kind: 'suite', portal: p, module: m, suite: s };
      }
    }
    return null;
  }, [tree, elevated, curMod, curSuite]);

  // A shared folder link (/?folder=s:<id>) is read once, on mount, and applied as
  // soon as the tree is here.
  const pendingFolder = useRef(peekInitialFolder());
  useEffect(() => {
    const f = pendingFolder.current;
    if (!f || tree.length === 0) return;
    pendingFolder.current = null;
    clearInitialFolder();
    const findSuite = (suites: ApiSuite[]): ApiSuite | null => {
      for (const sx of suites) {
        if (sx.id === f.id) return sx;
        const inChild = findSuite(sx.children);
        if (inChild) return inChild;
      }
      return null;
    };
    for (const p of tree) {
      if (f.kind === 'portal' && p.id === f.id) {
        setElevated({ kind: 'portal', portalId: p.id });
        return;
      }
      for (const m of p.modules) {
        if (f.kind === 'module' && m.id === f.id) {
          setElevated({ kind: 'module', portalId: p.id, moduleId: m.id });
          return;
        }
        const sx = f.kind === 'suite' ? findSuite(m.suites) : null;
        if (sx) {
          setElevated(null);
          onNavigate(m.name, sx.name);
          return;
        }
      }
    }
    alert('That folder was not found in this workspace.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  // Convenience accessors — null when the active selection doesn't include that level.
  const activeSuite = activeNode?.kind === 'suite' ? activeNode.suite : null;
  const activeModule =
    activeNode?.kind === 'suite' || activeNode?.kind === 'module' ? activeNode.module : null;
  const activePortal = activeNode?.portal ?? null;

  // Auto-expand the path to the active selection so it's visible after reload.
  useEffect(() => {
    if (!activeNode) return;
    setExpandedPortals(s => {
      if (s.has(activeNode.portal.id)) return s;
      const n = new Set(s);
      n.add(activeNode.portal.id);
      return n;
    });
    if (activeNode.kind === 'portal') return;
    setExpandedModules(s => {
      if (s.has(activeNode.module.id)) return s;
      const n = new Set(s);
      n.add(activeNode.module.id);
      return n;
    });
    if (activeNode.kind === 'module') return;
    // Walk every ancestor suite via parentId and add them to expandedSuites.
    const ancestorIds: string[] = [];
    let cursor: ApiSuite | null = activeNode.suite;
    while (cursor?.parentId) {
      ancestorIds.push(cursor.parentId);
      const find = (suites: ApiSuite[], id: string): ApiSuite | null => {
        for (const s of suites) {
          if (s.id === id) return s;
          const found = find(s.children, id);
          if (found) return found;
        }
        return null;
      };
      cursor = find(activeNode.module.suites, cursor.parentId);
    }
    if (ancestorIds.length > 0) {
      setExpandedSuites(s => {
        const n = new Set(s);
        ancestorIds.forEach(id => n.add(id));
        return n;
      });
    }
  }, [activeNode]);

  // Whenever currentKey changes (a suite click in the legacy parent flow), drop
  // any elevated portal/module selection so suite clicks always win.
  useEffect(() => {
    if (curMod && curSuite) setElevated(null);
  }, [curMod, curSuite]);

  // ─── Filters + paging ──────────────────────────────────────
  const [statusF, setStatusF] = useState<Set<string>>(new Set());
  const [priorityF, setPriorityF] = useState<Set<string>>(new Set());
  const [typeF, setTypeF] = useState<Set<string>>(new Set());
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

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

  // Reset to page 1 whenever filters or active selection change.
  const activeFolderId = activeNode
    ? activeNode.kind === 'suite'
      ? activeNode.suite.id
      : activeNode.kind === 'module'
        ? activeNode.module.id
        : activeNode.portal.id
    : null;
  const activeFolderKind = activeNode?.kind ?? null;
  const [folderLinkCopied, setFolderLinkCopied] = useState(false);
  // The address bar always names the open folder, so its URL can be copied and sent.
  useEffect(() => {
    if (!activeFolderId || !activeFolderKind || pendingFolder.current) return;
    window.history.replaceState(
      window.history.state,
      '',
      folderHref(activeFolderKind, activeFolderId),
    );
  }, [activeFolderId, activeFolderKind]);
  useEffect(
    () => () => {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('folder') && !sp.has('case'))
        window.history.replaceState(window.history.state, '', window.location.pathname);
    },
    [],
  );

  const activeSelectionKey =
    activeNode?.kind === 'suite'
      ? activeNode.suite.id
      : activeNode?.kind === 'module'
        ? activeNode.module.id
        : (activeNode?.portal.id ?? null);
  useEffect(() => {
    setPage(1);
    // A selection made on one suite/page shouldn't silently carry over and
    // get bulk-deleted after the user navigates somewhere else.
    setSelected(new Set());
  }, [statusF, priorityF, typeF, search, activeSelectionKey, pageSize]);

  // ─── Cases (server fetch) ──────────────────────────────────
  const [cases, setCases] = useState<ApiTestCase[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [casesLoading, setCasesLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
  const [showBulkMove, setShowBulkMove] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);

  // Close the per-row "Actions" menu when clicking outside it.
  useEffect(() => {
    if (!openRowMenu) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-row-menu]')) setOpenRowMenu(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [openRowMenu]);

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
        page: String(page),
        pageSize: String(pageSize),
        // "order" is the manual drag-and-drop position, kept in sync with the
        // old caseNum-based display order until a user actually drags a row.
        sort: 'order',
        order: 'asc',
      });
      // Filter by the deepest level the user has selected. Higher levels
      // include every nested case underneath (the API does the OR walk).
      if (activeNode.kind === 'suite') params.set('suiteId', activeNode.suite.id);
      else if (activeNode.kind === 'module') params.set('moduleId', activeNode.module.id);
      else params.set('portalId', activeNode.portal.id);
      statusF.forEach(s => params.append('status', s));
      priorityF.forEach(p => params.append('priority', p));
      typeF.forEach(t => params.append('type', t));
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
  }, [activeNode, page, pageSize, statusF, priorityF, typeF, search, dataVersion]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  // ─── Tree mutation state ───────────────────────────────────
  // Tracks an in-progress create/rename. `targetId` = parent for adds, node for renames.
  type EditKind =
    | 'add-portal'
    | 'add-module'
    | 'add-suite'
    /** Nested: add a child suite under an existing suite. targetId = parent suite id. */
    | 'add-subsuite'
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
  const [showImport, setShowImport] = useState(false);
  const [showNewCase, setShowNewCase] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showImproveAll, setShowImproveAll] = useState(false);
  const [exporting, setExporting] = useState(false);

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
  const startAdd = (
    kind: 'add-portal' | 'add-module' | 'add-suite' | 'add-subsuite',
    targetId: string | null,
  ) => {
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
    if (kind === 'add-subsuite' && targetId) {
      // Make sure the parent suite is open so the inline-input slot appears underneath it.
      setExpandedSuites(s => {
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
        case 'add-subsuite': {
          if (!edit.targetId) return;
          // edit.targetId is the parent suite — the API inherits moduleId from the parent.
          await api.post('/api/features', { name, parentSuiteId: edit.targetId });
          // Find the module that contains the parent suite, so we can navigate
          // into the new sub-suite once the tree refetches.
          let modName: string | null = null;
          const findInSuites = (suites: ApiSuite[], targetId: string): boolean => {
            for (const s of suites) {
              if (s.id === targetId) return true;
              if (findInSuites(s.children, targetId)) return true;
            }
            return false;
          };
          for (const p of tree) {
            for (const m of p.modules) {
              if (findInSuites(m.suites, edit.targetId!)) {
                modName = m.name;
                break;
              }
            }
            if (modName) break;
          }
          if (modName) onNavigate(modName, name);
          // Auto-expand the new sub-suite's parent so the user can see it.
          setExpandedSuites(s => {
            const n = new Set(s);
            n.add(edit.targetId!);
            return n;
          });
          break;
        }
        case 'rename-portal':
          if (!edit.targetId) return;
          await api.patch(`/api/portals/${edit.targetId}`, { name });
          break;
        case 'rename-module': {
          if (!edit.targetId) return;
          await api.patch(`/api/modules/${edit.targetId}`, { name });
          // Keep currentKey in sync if we renamed the active module (only meaningful
          // when a suite is selected — module-only selection uses ids, not names).
          if (activeNode?.kind === 'suite' && activeNode.module.id === edit.targetId) {
            onNavigate(name, activeNode.suite.name);
          }
          break;
        }
        case 'rename-suite': {
          if (!edit.targetId) return;
          await api.patch(`/api/features/${edit.targetId}`, { name });
          if (activeNode?.kind === 'suite' && activeNode.suite.id === edit.targetId) {
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

  // Single-row actions (the "…" menu on each test case row).
  const deleteCase = async (tc: ApiTestCase) => {
    setOpenRowMenu(null);
    if (!window.confirm(`Delete "${tc.title}"?\n\nThis cannot be undone.`)) return;
    try {
      await api.del(`/api/test-cases/${tc.id}`);
      await Promise.all([reloadTree(), fetchCases()]);
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  };
  const duplicateCase = async (tc: ApiTestCase) => {
    setOpenRowMenu(null);
    try {
      await api.post('/api/test-cases/bulk', { action: 'duplicate', ids: [tc.id] });
      await Promise.all([reloadTree(), fetchCases()]);
    } catch (e) {
      alert(`Duplicate failed: ${(e as Error).message}`);
    }
  };

  // Bulk actions on the checked rows.
  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Delete ${ids.length} test case${ids.length === 1 ? '' : 's'}?\n\nThis cannot be undone.`,
      )
    )
      return;
    setBulkBusy(true);
    try {
      await api.post('/api/test-cases/bulk', { action: 'delete', ids });
      setSelected(new Set());
      await Promise.all([reloadTree(), fetchCases()]);
    } catch (e) {
      alert(`Bulk delete failed: ${(e as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  };
  const bulkDuplicate = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      await api.post('/api/test-cases/bulk', { action: 'duplicate', ids });
      setSelected(new Set());
      await Promise.all([reloadTree(), fetchCases()]);
    } catch (e) {
      alert(`Bulk duplicate failed: ${(e as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  };
  const bulkMove = async (suiteId: string) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      await api.post('/api/test-cases/bulk', { action: 'move', ids, targetSuiteId: suiteId });
      setSelected(new Set());
      setShowBulkMove(false);
      await Promise.all([reloadTree(), fetchCases()]);
    } catch (e) {
      alert(`Bulk move failed: ${(e as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  };
  const bulkEdit = async (patch: Partial<Record<'priority' | 'severity' | 'type', string>>) => {
    const ids = Array.from(selected);
    if (ids.length === 0 || Object.keys(patch).length === 0) return;
    setBulkBusy(true);
    try {
      await api.post('/api/test-cases/bulk', { action: 'update', ids, patch });
      setSelected(new Set());
      setShowBulkEdit(false);
      await Promise.all([reloadTree(), fetchCases()]);
    } catch (e) {
      alert(`Bulk edit failed: ${(e as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  };

  // Top-of-header "+ New suite" shortcut: adds a suite under the active module inline.
  const addSuiteUnderActive = () => {
    if (!activeModule) return;
    startAdd('add-suite', activeModule.id);
  };

  // Export every case at-or-below the active selection (not just the current
  // page). Honours the active filter chips so what's exported matches the screen.
  const handleExport = async () => {
    if (!activeNode || exporting) return;
    try {
      setExporting(true);
      const params = new URLSearchParams({
        page: '1',
        pageSize: '1000',
        sort: 'caseNum',
        order: 'asc',
      });
      if (activeNode.kind === 'suite') params.set('suiteId', activeNode.suite.id);
      else if (activeNode.kind === 'module') params.set('moduleId', activeNode.module.id);
      else params.set('portalId', activeNode.portal.id);
      statusF.forEach(s => params.append('status', s));
      priorityF.forEach(p => params.append('priority', p));
      typeF.forEach(t => params.append('type', t));
      if (search.trim()) params.set('search', search.trim());

      const data = await api.get<{ items: ApiTestCase[]; total: number }>(
        `/api/test-cases?${params.toString()}`,
      );
      if (data.items.length === 0) {
        alert('No test cases to export with the current filters.');
        return;
      }
      exportApiTestCases(data.items, {
        workspace: projectName,
        portal: activeNode.portal.name,
        module: activeModule?.name ?? '',
        suite: activeSuite?.name ?? '',
      });
    } catch (e) {
      alert(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const clearAll = () => {
    setStatusF(new Set());
    setPriorityF(new Set());
    setTypeF(new Set());
    setSearch('');
  };
  const activeFilterCount = statusF.size + priorityF.size + typeF.size + (search.trim() ? 1 : 0);

  // Drag-to-reorder only makes sense against one clean, fully-loaded sibling
  // group: a suite's own directly-attached cases (a Module/Portal view mixes
  // in nested-suite cases too, which don't share one order sequence), and
  // only when every sibling is actually on screen (not split across pages).
  const canReorderCases =
    activeNode?.kind === 'suite' && cases.length === total && cases.length > 1;

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

  // ─── Tree filter ("Filter sections…") ──────────────────────
  // Case-insensitive name match. A node stays visible when it, or anything
  // beneath it, matches, and every ancestor of a match is shown expanded.
  const [treeQuery, setTreeQuery] = useState('');
  const tq = treeQuery.trim().toLowerCase();
  const nameHit = (name: string) => name.toLowerCase().includes(tq);
  const suiteHit = (s: ApiSuite): boolean => nameHit(s.name) || s.children.some(suiteHit);
  const moduleHit = (m: ApiModule): boolean => nameHit(m.name) || m.suites.some(suiteHit);
  const portalHit = (p: ApiPortal): boolean => nameHit(p.name) || p.modules.some(moduleHit);

  // ─── Inline "Case title" quick add ─────────────────────────
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const submitQuickAdd = async () => {
    const title = (quickAdd ?? '').trim();
    if (!title || !activeNode || quickBusy) return;
    try {
      setQuickBusy(true);
      const parent =
        activeNode.kind === 'suite'
          ? { suiteId: activeNode.suite.id }
          : activeNode.kind === 'module'
            ? { moduleId: activeNode.module.id }
            : { portalId: activeNode.portal.id };
      // The API needs explicit classification keys (it has no defaults), so
      // pick the workspace's usual Medium / Minor / Functional, falling back to
      // whatever the first configured option is.
      const pick = (opts: CaseOption[], name: string) =>
        opts.find(o => o.name === name)?.key ?? opts[0]?.key;
      await api.post('/api/test-cases', {
        title,
        status: 'Draft',
        author: authorName,
        priority: pick(caseOptions.priority, 'Medium'),
        severity: pick(caseOptions.severity, 'Minor'),
        type: pick(caseOptions.type, 'Functional'),
        ...parent,
      });
      setQuickAdd(null);
      await fetchCases();
      await reloadTree();
    } catch (e) {
      alert(`Could not add the case: ${(e as Error).message}`);
    } finally {
      setQuickBusy(false);
    }
  };

  // ─── Full-page "New test case" form ────────────────────────
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const createCase = async (v: TestCaseFormValues) => {
    setFormSaving(true);
    setFormError('');
    try {
      await api.post('/api/test-cases', {
        title: v.title,
        desc: v.desc,
        preconditions: v.preconditions,
        steps: v.steps,
        expected: v.expected,
        priority: v.priority,
        severity: v.severity,
        type: v.type,
        status: v.status,
        ownerId: v.ownerId,
        labels: v.labels,
        attachments: v.attachments,
        author: authorName,
        // Exactly one parent — the deepest pick wins.
        ...(v.suiteId
          ? { suiteId: v.suiteId }
          : v.moduleId
            ? { moduleId: v.moduleId }
            : { portalId: v.portalId }),
      });
      setShowNewCase(false);
      await Promise.all([reloadTree(), fetchCases()]);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setFormSaving(false);
    }
  };

  // Sibling suites count for the header subtitle (e.g. "3 suites" under the same module).
  const siblingSuiteCount = activeModule?.suites.length ?? 0;

  const toggleSuiteExpand = (id: string) =>
    setExpandedSuites(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // Recursive renderer for a single suite + its nested children.
  // depth controls nesting; modName + portalId thread through to the action
  // callbacks. Each level supports add-subsuite / rename / delete / copy, and
  // clicking the label navigates to that suite.
  const renderSuiteNode = (
    suite: ApiSuite,
    depth: number,
    modName: string,
    moduleId: string,
    portalId: string,
    siblings: ApiSuite[],
  ): React.ReactNode => {
    const active = activeNode?.kind === 'suite' && activeNode.suite.id === suite.id;
    const isRenamingSuite = edit?.kind === 'rename-suite' && edit.targetId === suite.id;
    const isAddingChildHere = edit?.kind === 'add-subsuite' && edit.targetId === suite.id;
    const isOpen = tq ? true : expandedSuites.has(suite.id);
    const kids = tq && !nameHit(suite.name) ? suite.children.filter(suiteHit) : suite.children;

    return (
      <div key={suite.id}>
        <NodeRow
          isActive={active}
          isRenaming={isRenamingSuite}
          drag={dragHandlersFor(
            `suites:${moduleId}:${suite.parentId ?? 'root'}`,
            suite.id,
            siblings.map(s => s.id),
            ids => reorderSuites(portalId, moduleId, suite.parentId, ids),
          )}
          // Every suite shows a chevron — any suite can take sub-folders.
          toggle={{
            open: isOpen || isAddingChildHere,
            onToggle: () => toggleSuiteExpand(suite.id),
          }}
          onLabelClick={() => pickSuite(modName, suite.name)}
          icon={<Ico name="folder" />}
          label={suite.name}
          count={suiteTotal(suite)}
          renameDraft={isRenamingSuite ? edit!.draft : ''}
          onRenameChange={v => setEdit(e => (e ? { ...e, draft: v } : e))}
          onRenameSubmit={submitEdit}
          onRenameCancel={cancelEdit}
          actions={
            <>
              <NodeAction
                icon="ti-folder-plus"
                title="Add subfolder"
                onClick={() => startAdd('add-subsuite', suite.id)}
              />
              <NodeAction
                icon="ti-copy"
                title="Copy suite to another module"
                onClick={() =>
                  setCopyTarget({
                    kind: 'suite',
                    id: suite.id,
                    name: suite.name,
                    sourceModuleId: moduleId,
                    sourcePortalId: portalId,
                  })
                }
              />
              <NodeAction
                icon="ti-pencil"
                title="Rename suite"
                onClick={() => startRename('rename-suite', suite.id, suite.name)}
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

        {(isOpen || isAddingChildHere) && (kids.length > 0 || isAddingChildHere) && (
          <div className="tree-children">
            {kids.map(child =>
              renderSuiteNode(child, depth + 1, modName, moduleId, portalId, suite.children),
            )}
            {isAddingChildHere && (
              <InlineRow
                placeholder="Subfolder name…"
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
  };

  // Totals for the page title ("1,082 cases · 16 sections"): every case in the
  // workspace and every module/suite node in the tree.
  // The API's _count is per node (cases attached directly to it), so roll the
  // totals up here: a module shows its own cases plus every suite beneath it.
  const suiteTotal = (s: ApiSuite): number =>
    (s._count?.testCases ?? 0) + s.children.reduce((n, ch) => n + suiteTotal(ch), 0);
  const moduleTotal = (m: ApiModule): number =>
    (m._count?.testCases ?? 0) + m.suites.reduce((n, s) => n + suiteTotal(s), 0);
  const portalTotal = (p: ApiPortal): number =>
    (p._count?.testCases ?? 0) + p.modules.reduce((n, m) => n + moduleTotal(m), 0);
  const totalCases = tree.reduce((sum, p) => sum + portalTotal(p), 0);
  const countSuites = (ss: ApiSuite[]): number =>
    ss.reduce((n, s) => n + 1 + countSuites(s.children), 0);
  const totalSections = tree.reduce(
    (n, p) => n + p.modules.reduce((m, mod) => m + 1 + countSuites(mod.suites), 0),
    0,
  );
  const allSelected = cases.length > 0 && selected.size === cases.length;

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {showNewCase && activeNode && projectId ? (
        <TestCaseForm
          mode="create"
          projectId={projectId}
          projectName={projectName}
          tree={tree}
          initial={{
            portalId: activeNode.portal.id,
            moduleId: activeNode.kind !== 'portal' ? activeNode.module.id : undefined,
            suiteId: activeNode.kind === 'suite' ? activeNode.suite.id : undefined,
          }}
          authorName={authorName}
          saving={formSaving}
          error={formError}
          onCancel={() => {
            setShowNewCase(false);
            setFormError('');
          }}
          onSubmit={createCase}
        />
      ) : (
        <div className="tcv3 main-scroll compact">
          {/* Page header: breadcrumb + title on the left, page actions on the right */}
          <div className="page-header">
            <div>
              <div className="breadcrumb">
                <span className="crumb">{projectName || 'Project'}</span>
                {activeNode ? (
                  <>
                    <span className="sep">/</span>
                    <span className={activeNode.kind === 'portal' ? 'current' : 'crumb'}>
                      {activeNode.portal.name}
                    </span>
                    {activeModule && (
                      <>
                        <span className="sep">/</span>
                        <span className={activeNode.kind === 'module' ? 'current' : 'crumb'}>
                          {activeModule.name}
                        </span>
                      </>
                    )}
                    {activeSuite && (
                      <>
                        <span className="sep">/</span>
                        <span className="current">{activeSuite.name}</span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <span className="sep">/</span>
                    <span className="current">Test cases</span>
                  </>
                )}
              </div>
              <h1 className="page-title compact">
                Repository{' '}
                <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--t-3)', marginLeft: 8 }}>
                  {totalCases.toLocaleString('en-US')} cases · {totalSections} sections
                </span>
              </h1>
            </div>
            <div className="page-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAi(true)}
                disabled={!projectId || !activeNode}
                title={
                  activeNode
                    ? 'Generate test cases from a requirement'
                    : 'Pick a portal, module or suite first'
                }
              >
                <svg viewBox="0 0 24 24">
                  <path d="M12 2L14.5 9.5 22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
                </svg>
                Generate with AI
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowImproveAll(true)}
                disabled={!projectId || !activeNode || total === 0}
                title={
                  activeNode
                    ? 'Improve every test case in this folder with AI, optionally using a requirement document'
                    : 'Pick a portal, module or suite first'
                }
              >
                <svg viewBox="0 0 24 24">
                  <path d="M12 2L14.5 9.5 22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
                </svg>
                Improve all with AI
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowImport(true)}
                disabled={!projectId}
                title="Import test cases from a CSV file"
              >
                <Ico name="download" />
                Import
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleExport}
                disabled={!activeNode || exporting}
                title={
                  activeNode
                    ? `Export ${activeSuite?.name ?? activeModule?.name ?? activePortal?.name} to Excel`
                    : 'Pick a folder first'
                }
              >
                <Ico name="upload" />
                Export
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={addSuiteUnderActive}
                disabled={!activeModule}
                title={
                  activeModule ? `Add suite under ${activeModule.name}` : 'Pick a module first'
                }
              >
                <Ico name="plus" />
                New suite
              </button>
            </div>
          </div>

          {/* Toolbar: selection · bulk actions · filters */}
          <div className="toolbar" ref={filterBarRef}>
            <div className="tb-group">
              <button
                type="button"
                className={cn(
                  'cb',
                  allSelected && 'on',
                  !allSelected && selected.size > 0 && 'indet',
                )}
                onClick={toggleSelectAll}
                disabled={cases.length === 0}
                title={allSelected ? 'Clear selection' : 'Select all on this page'}
              >
                <Ico name="check" />
              </button>
              <span style={{ fontSize: 12, color: 'var(--t-2)', fontWeight: 500 }}>
                {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
              </span>
            </div>
            <div className="tb-group">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={selected.size === 0 || bulkBusy}
                onClick={() => setShowBulkEdit(true)}
              >
                <Ico name="pencil" /> Edit fields
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={selected.size === 0 || bulkBusy}
                onClick={bulkDuplicate}
              >
                <Ico name="copy" /> Duplicate
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={selected.size === 0 || bulkBusy}
                onClick={() => setShowBulkMove(true)}
              >
                <Ico name="move" /> Move
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--err)' }}
                disabled={selected.size === 0 || bulkBusy}
                onClick={bulkDelete}
              >
                <Ico name="trash" /> Delete
              </button>
            </div>
            <div className="tb-group">
              <FilterSelect
                label="Status"
                allLabel="All statuses"
                width={140}
                options={STATUS_OPTIONS}
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
              <FilterSelect
                label="Priority"
                allLabel="All priorities"
                width={130}
                options={caseOptions.priority.map(o => ({ value: o.key, label: o.name }))}
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
              <FilterSelect
                label="Type"
                allLabel="All types"
                width={130}
                options={caseOptions.type.map(o => ({ value: o.key, label: o.name }))}
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
              <div style={{ position: 'relative' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    color: 'var(--t-3)',
                    pointerEvents: 'none',
                  }}
                >
                  <Ico name="search" size={13} />
                </span>
                <input
                  type="text"
                  className="input"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search in section…"
                  style={{ width: 180, fontSize: 12, padding: '6px 10px 6px 30px' }}
                />
              </div>
              {activeFilterCount > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Tree + case list */}
          <div className="tc-split">
            {/* Tree */}
            <div className="tree tc-tree">
              <div className="tree-search">
                <Ico name="search" />
                <input
                  placeholder="Filter sections…"
                  value={treeQuery}
                  onChange={e => setTreeQuery(e.target.value)}
                />
              </div>

              {treeLoading && tree.length === 0 && (
                <p
                  style={{
                    padding: '8px 10px',
                    fontSize: 12,
                    fontStyle: 'italic',
                    color: 'var(--t-3)',
                  }}
                >
                  Loading…
                </p>
              )}
              {!treeLoading && tree.length === 0 && !edit && (
                <p
                  style={{
                    padding: '8px 10px',
                    fontSize: 12,
                    fontStyle: 'italic',
                    color: 'var(--t-3)',
                  }}
                >
                  No portals yet — use “New portal” below.
                </p>
              )}
              {tq && !tree.some(portalHit) && tree.length > 0 && (
                <p
                  style={{
                    padding: '8px 10px',
                    fontSize: 12,
                    fontStyle: 'italic',
                    color: 'var(--t-3)',
                  }}
                >
                  No sections match “{treeQuery.trim()}”.
                </p>
              )}

              {/* Inline "add portal" input lives at the very top of the tree. */}
              {edit?.kind === 'add-portal' && (
                <InlineRow
                  placeholder="Portal name…"
                  draft={edit.draft}
                  setDraft={v => setEdit(e => (e ? { ...e, draft: v } : e))}
                  onSubmit={submitEdit}
                  onCancel={cancelEdit}
                />
              )}

              {tree
                .filter(p => !tq || portalHit(p))
                .map(portal => {
                  const pOpen = tq ? true : expandedPortals.has(portal.id);
                  const isRenamingPortal =
                    edit?.kind === 'rename-portal' && edit.targetId === portal.id;
                  const mods =
                    tq && !nameHit(portal.name) ? portal.modules.filter(moduleHit) : portal.modules;
                  const addingModule = edit?.kind === 'add-module' && edit.targetId === portal.id;
                  return (
                    <div key={portal.id}>
                      <NodeRow
                        isActive={
                          activeNode?.kind === 'portal' && activeNode.portal.id === portal.id
                        }
                        isRenaming={isRenamingPortal}
                        drag={dragHandlersFor(
                          'portals',
                          portal.id,
                          tree.map(p => p.id),
                          reorderPortals,
                        )}
                        // Single click selects the portal (its cases show on the right);
                        // the chevron separately toggles expansion.
                        onLabelClick={() => setElevated({ kind: 'portal', portalId: portal.id })}
                        toggle={{ open: pOpen, onToggle: () => togglePortal(portal.id) }}
                        icon={<Ico name="portal" />}
                        label={portal.name}
                        count={portalTotal(portal)}
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

                      {pOpen && (mods.length > 0 || addingModule) && (
                        <div className="tree-children">
                          {mods.map(mod => {
                            const mOpen = tq ? true : expandedModules.has(mod.id);
                            const isRenamingModule =
                              edit?.kind === 'rename-module' && edit.targetId === mod.id;
                            const suites =
                              tq && !nameHit(mod.name) ? mod.suites.filter(suiteHit) : mod.suites;
                            const addingSuite =
                              edit?.kind === 'add-suite' && edit.targetId === mod.id;
                            return (
                              <div key={mod.id}>
                                <NodeRow
                                  isActive={
                                    activeNode?.kind === 'module' && activeNode.module.id === mod.id
                                  }
                                  isRenaming={isRenamingModule}
                                  drag={dragHandlersFor(
                                    `modules:${portal.id}`,
                                    mod.id,
                                    portal.modules.map(m => m.id),
                                    ids => reorderModules(portal.id, ids),
                                  )}
                                  // Selecting a module shows its direct + nested cases.
                                  onLabelClick={() =>
                                    setElevated({
                                      kind: 'module',
                                      portalId: portal.id,
                                      moduleId: mod.id,
                                    })
                                  }
                                  toggle={{ open: mOpen, onToggle: () => toggleModule(mod.id) }}
                                  icon={<Ico name="folder" />}
                                  label={mod.name}
                                  count={moduleTotal(mod)}
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
                                        onClick={() =>
                                          startRename('rename-module', mod.id, mod.name)
                                        }
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

                                {mOpen && (suites.length > 0 || addingSuite) && (
                                  <div className="tree-children">
                                    {/* Recursive — each suite renders itself + nested children. */}
                                    {suites.map(suite =>
                                      renderSuiteNode(
                                        suite,
                                        0,
                                        mod.name,
                                        mod.id,
                                        portal.id,
                                        mod.suites,
                                      ),
                                    )}

                                    {/* Inline "add suite" input at the bottom of the module. */}
                                    {addingSuite && (
                                      <InlineRow
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
                          {addingModule && (
                            <InlineRow
                              placeholder="Module name…"
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

              <div style={{ marginTop: 10, padding: 6, borderTop: '1px solid var(--bdr)' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--brand-700)' }}
                  onClick={() => startAdd('add-portal', null)}
                  disabled={!projectId}
                >
                  <Ico name="plus" /> New portal
                </button>
              </div>
            </div>

            {/* Case list */}
            <div style={{ minWidth: 0 }}>
              {!activeNode ? (
                <div
                  className="sec-body"
                  style={{ borderTop: '1px solid var(--bdr)', borderRadius: 12 }}
                >
                  <div className="empty">
                    <b>Pick a section</b>
                    Use the tree on the left to drill down to a suite.
                  </div>
                </div>
              ) : (
                <>
                  <div className="sec-head">
                    <div className="sec-title">
                      <span className="ico">
                        <Ico name="folder" size={14} />
                      </span>
                      <h3>
                        {activeSuite
                          ? `${activeModule?.name ?? ''} / ${activeSuite.name}`
                          : (activeModule?.name ?? activePortal?.name ?? '')}
                      </h3>
                      <span className="pill pill-brand" style={{ marginLeft: 6 }}>
                        {total} case{total === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          if (activeNode.kind === 'suite')
                            startRename('rename-suite', activeNode.suite.id, activeNode.suite.name);
                          else if (activeNode.kind === 'module')
                            startRename(
                              'rename-module',
                              activeNode.module.id,
                              activeNode.module.name,
                            );
                          else
                            startRename(
                              'rename-portal',
                              activeNode.portal.id,
                              activeNode.portal.name,
                            );
                        }}
                      >
                        Edit {activeNode.kind === 'suite' ? 'section' : activeNode.kind}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Copy a link to this folder"
                        onClick={async () => {
                          const id =
                            activeNode.kind === 'suite'
                              ? activeNode.suite.id
                              : activeNode.kind === 'module'
                                ? activeNode.module.id
                                : activeNode.portal.id;
                          const url = folderUrl(activeNode.kind, id);
                          try {
                            await navigator.clipboard.writeText(url);
                            setFolderLinkCopied(true);
                            setTimeout(() => setFolderLinkCopied(false), 2000);
                          } catch {
                            window.prompt('Copy this link:', url);
                          }
                        }}
                      >
                        {folderLinkCopied ? 'Link copied' : 'Copy link'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setQuickAdd('')}
                        title="Type a title and press Enter to add a draft case"
                      >
                        Quick add
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setShowNewCase(true)}
                      >
                        <Ico name="plus" /> New case
                      </button>
                    </div>
                  </div>

                  <div className="sec-body">
                    {/* Inline title entry */}
                    {quickAdd !== null && (
                      <div className="ie-wrap">
                        <div className="inline-edit">
                          <span className="ie-label">Case title:</span>
                          <input
                            autoFocus
                            value={quickAdd}
                            onChange={e => setQuickAdd(e.target.value)}
                            placeholder="Describe what this case verifies…"
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                submitQuickAdd();
                              }
                              if (e.key === 'Escape') setQuickAdd(null);
                            }}
                          />
                          <button
                            type="button"
                            className="ie-action ok"
                            title="Add case"
                            disabled={!quickAdd.trim() || quickBusy}
                            onClick={submitQuickAdd}
                          >
                            <Ico name="check" />
                          </button>
                          <button
                            type="button"
                            className="ie-action cancel"
                            title="Cancel"
                            onClick={() => setQuickAdd(null)}
                          >
                            <Ico name="x" />
                          </button>
                        </div>
                      </div>
                    )}

                    {casesLoading && cases.length === 0 ? (
                      <div className="empty">Loading…</div>
                    ) : cases.length === 0 ? (
                      <div className="empty">
                        <b>No test cases match</b>
                        {activeFilterCount > 0
                          ? 'Try widening or clearing your filters.'
                          : 'Click “New case” to create the first one.'}
                      </div>
                    ) : (
                      cases.map(tc => {
                        const isSel = selected.has(tc.id);
                        const rowDrag = canReorderCases
                          ? dragHandlersFor(
                              `cases:${activeNode.kind === 'suite' ? activeNode.suite.id : ''}`,
                              tc.id,
                              cases.map(c => c.id),
                              reorderCases,
                            )
                          : null;
                        const pr = priorityToneDisplay(tc);
                        const ty = typeDisplay(tc);
                        const last =
                          tc.lastResult && tc.lastResult !== 'NotRun' ? tc.lastResult : null;
                        return (
                          <div
                            key={tc.id}
                            onClick={() => onOpenCase(tc, cases)}
                            draggable={!!rowDrag}
                            onDragStart={rowDrag?.onDragStart}
                            onDragOver={rowDrag?.onDragOver}
                            onDrop={rowDrag?.onDrop}
                            onDragEnd={rowDrag?.onDragEnd}
                            style={{ position: 'relative' }}
                            className={cn(
                              'case-row',
                              isSel && 'selected',
                              rowDrag?.isDragOver && 'drag-over',
                              rowDrag?.isDragging && 'dragging',
                            )}
                          >
                            <button
                              type="button"
                              className={cn('cb', isSel && 'on')}
                              onClick={e => {
                                e.stopPropagation();
                                toggleSelect(tc.id);
                              }}
                            >
                              <Ico name="check" />
                            </button>
                            <a
                              className="cid cid-link"
                              href={caseHref(tc.caseNum)}
                              title={`${caseCode(tc.caseNum)} — right-click to copy the link`}
                              onClick={e => {
                                // Ctrl / Cmd / middle click opens the link in a new tab; a plain
                                // click is the row's normal "open this case".
                                if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0)
                                  e.stopPropagation();
                                else e.preventDefault();
                              }}
                            >
                              {caseCode(tc.caseNum)}
                            </a>
                            <span className="ctitle">
                              {tc.title}
                              {tc.status === 'Draft' && <span className="draft-tag">· draft</span>}
                            </span>
                            <span className="cmeta">
                              {last && (
                                <span className={cn('pill', resultPillClass(last))}>{last}</span>
                              )}
                              <span className={cn('pill', statusPillClass(tc.status))}>
                                {tc.status !== 'Archived' && <span className="dot" />} {tc.status}
                              </span>
                              <span
                                className={cn(
                                  'pill',
                                  optionPillClass(
                                    caseOptions.priority,
                                    pr.label,
                                    priorityPillClass(pr.label),
                                    tc.customPriority?.color,
                                  ),
                                )}
                              >
                                {pr.label}
                              </span>
                              <span
                                className={cn(
                                  'pill',
                                  optionPillClass(
                                    caseOptions.type,
                                    ty.label,
                                    typePillClass(ty.label),
                                    tc.customType?.color,
                                  ),
                                )}
                              >
                                {ty.label}
                              </span>
                              <OwnerAvatar user={tc.owner} />
                            </span>
                          </div>
                        );
                      })
                    )}

                    <div className="list-foot">
                      <span>
                        Showing {cases.length} of {total} case{total === 1 ? '' : 's'} in this
                        section
                      </span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>Per page</span>
                          <select
                            value={pageSize}
                            onChange={e => setPageSize(Number(e.target.value))}
                            className="select btn-sm"
                            style={{ width: 70, padding: '3px 24px 3px 8px' }}
                          >
                            {PAGE_SIZE_OPTIONS.map(opt => (
                              <option key={opt} value={opt}>
                                {opt === ALL_PAGE_SIZE ? 'All' : opt}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={page === 1}
                        >
                          <Ico name="left" />
                        </button>
                        <span style={{ padding: '6px 10px', fontSize: 12 }}>
                          {page} / {totalPages}
                        </span>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          disabled={page >= totalPages}
                        >
                          <Ico name="right" />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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

      {showAi && activeNode && (
        <AiGeneratePanel
          projectId={projectId ?? ''}
          parentType={activeNode.kind}
          parentId={
            activeNode.kind === 'suite'
              ? activeNode.suite.id
              : activeNode.kind === 'module'
                ? activeNode.module.id
                : activeNode.portal.id
          }
          parentPath={[
            activeNode.portal.name,
            activeNode.kind !== 'portal' ? activeNode.module.name : null,
            activeNode.kind === 'suite' ? activeNode.suite.name : null,
          ]
            .filter(Boolean)
            .join(' › ')}
          onClose={() => setShowAi(false)}
          onChanged={() => {
            void fetchCases();
            void reloadTree();
          }}
        />
      )}
      {showImproveAll && activeNode && (
        <AiImproveFolderPanel
          projectId={projectId ?? ''}
          parentType={activeNode.kind}
          parentId={
            activeNode.kind === 'suite'
              ? activeNode.suite.id
              : activeNode.kind === 'module'
                ? activeNode.module.id
                : activeNode.portal.id
          }
          parentPath={[
            activeNode.portal.name,
            activeNode.kind !== 'portal' ? activeNode.module.name : null,
            activeNode.kind === 'suite' ? activeNode.suite.name : null,
          ]
            .filter(Boolean)
            .join(' › ')}
          onClose={() => setShowImproveAll(false)}
          onChanged={() => {
            void fetchCases();
          }}
        />
      )}
      {/* CSV import dialog */}
      {showImport && projectId && (
        <ImportCsvModal
          projectId={projectId}
          projectName={projectName || ''}
          portalSuggestions={tree.map(p => ({
            name: p.name,
            modules: p.modules.map(m => ({
              name: m.name,
              suites: m.suites.map(s => ({ name: s.name })),
            })),
          }))}
          onClose={() => setShowImport(false)}
          onImported={async () => {
            await reloadTree();
          }}
        />
      )}

      {showBulkMove && (
        <BulkMoveModal
          tree={tree}
          count={selected.size}
          busy={bulkBusy}
          onClose={() => setShowBulkMove(false)}
          onMove={bulkMove}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          count={selected.size}
          busy={bulkBusy}
          caseOptions={caseOptions}
          onClose={() => setShowBulkEdit(false)}
          onSave={bulkEdit}
        />
      )}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────

// ─── Hierarchy node row ────────────────────────────────────
// Renders one portal/module/suite line in the mockup's `.tree-node` style:
// chevron · folder icon · name · count, with hover-revealed action buttons and
// an inline rename input when isRenaming is true.

interface NodeRowProps {
  isActive: boolean;
  isRenaming: boolean;
  /** Expand/collapse control. Every node gets a chevron (a suite can always
   *  take sub-folders), so this is only omitted for non-expandable rows. */
  toggle?: { open: boolean; onToggle: () => void } | null;
  icon: React.ReactNode;
  label: string;
  /** Case count shown on the right (hidden on hover to make room for actions). */
  count?: number | null;
  onLabelClick: () => void;
  actions: React.ReactNode;
  renameDraft: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  /** Drag-and-drop reorder handlers — omitted when this row isn't in a
   *  drag-reorderable list (e.g. while a rename is in progress elsewhere). */
  drag?: DragHandlers;
}

function NodeRow({
  isActive,
  isRenaming,
  toggle,
  icon,
  label,
  count,
  onLabelClick,
  actions,
  renameDraft,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  drag,
}: NodeRowProps) {
  return (
    <div
      // role="button" instead of <button>: the chevron inside is itself a
      // <button>, and nesting buttons is invalid HTML.
      role="button"
      tabIndex={0}
      draggable={!!drag && !isRenaming}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
      onClick={isRenaming ? undefined : onLabelClick}
      onKeyDown={e => {
        if (isRenaming) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onLabelClick();
        }
      }}
      className={cn(
        'tree-node',
        toggle?.open && 'open',
        isActive && 'active',
        drag?.isDragOver && 'drag-over',
        drag?.isDragging && 'dragging',
      )}
    >
      {toggle ? (
        <button
          type="button"
          className="chev"
          onClick={e => {
            e.stopPropagation();
            toggle.onToggle();
          }}
          aria-label={toggle.open ? 'Collapse' : 'Expand'}
        >
          <Ico name="chevron" />
        </button>
      ) : (
        <span className="chev leaf">
          <Ico name="chevron" />
        </span>
      )}
      <span className="ico">{icon}</span>
      {isRenaming ? (
        <input
          autoFocus
          className="rename-input"
          value={renameDraft}
          onClick={e => e.stopPropagation()}
          onChange={e => onRenameChange(e.target.value)}
          onBlur={onRenameSubmit}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              onRenameSubmit();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              onRenameCancel();
            }
          }}
        />
      ) : (
        <span className="label" title={label}>
          {label}
        </span>
      )}
      {!isRenaming && count != null && <span className="count">{count}</span>}
      {!isRenaming && <span className="node-actions">{actions}</span>}
    </div>
  );
}

// Tabler icon names the call sites already pass, mapped to the mockup's SVGs.
const NODE_ACTION_ICONS: Record<string, React.ComponentProps<typeof Ico>['name']> = {
  'ti-plus': 'plus',
  'ti-pencil': 'pencil',
  'ti-trash': 'trash',
  'ti-copy': 'copy',
  'ti-folder-plus': 'folder-plus',
};

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
      className={danger ? 'danger' : undefined}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Ico name={NODE_ACTION_ICONS[icon] ?? 'plus'} />
    </button>
  );
}

// Inline input row used when creating a new portal / module / suite.
function InlineRow({
  placeholder,
  draft,
  setDraft,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="tree-node active" style={{ cursor: 'default' }}>
      <span className="chev leaf">
        <Ico name="chevron" />
      </span>
      <span className="ico">
        <Ico name="folder" />
      </span>
      <input
        autoFocus
        className="rename-input"
        value={draft}
        placeholder={placeholder}
        onChange={e => setDraft(e.target.value)}
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
      />
    </div>
  );
}

// Flattens a suite's nested children into one pickable list, indenting nested
// names with " / " so a deeply-nested suite is still identifiable in a flat
// <select> (move/edit targets don't need the full tree UI, just a valid pick).
function flattenSuites(suites: ApiSuite[], prefix = ''): { id: string; label: string }[] {
  return suites.flatMap(s => [
    { id: s.id, label: prefix + s.name },
    ...flattenSuites(s.children, `${prefix}${s.name} / `),
  ]);
}

function BulkMoveModal({
  tree,
  count,
  busy,
  onClose,
  onMove,
}: {
  tree: ApiPortal[];
  count: number;
  busy: boolean;
  onClose: () => void;
  onMove: (suiteId: string) => void;
}) {
  const [portalId, setPortalId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [suiteId, setSuiteId] = useState('');

  const portal = tree.find(p => p.id === portalId);
  const modules = portal?.modules ?? [];
  const mod = modules.find(m => m.id === moduleId);
  const suites = mod ? flattenSuites(mod.suites) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[440px] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">
            Move {count} case{count === 1 ? '' : 's'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Portal</span>
            <select
              value={portalId}
              onChange={e => {
                setPortalId(e.target.value);
                setModuleId('');
                setSuiteId('');
              }}
              className={MODAL_SELECT_CLS}
            >
              <option value="">Select a portal…</option>
              {tree.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Module</span>
            <select
              value={moduleId}
              disabled={!portal}
              onChange={e => {
                setModuleId(e.target.value);
                setSuiteId('');
              }}
              className={MODAL_SELECT_CLS}
            >
              <option value="">Select a module…</option>
              {modules.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Feature</span>
            <select
              value={suiteId}
              disabled={!mod}
              onChange={e => setSuiteId(e.target.value)}
              className={MODAL_SELECT_CLS}
            >
              <option value="">Select a feature…</option>
              {suites.map(s => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-slate-400">
            Cases move to the selected feature — a feature (not a module or portal) is required as
            the destination.
          </p>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => suiteId && onMove(suiteId)}
            disabled={busy || !suiteId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
            Move
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkEditModal({
  count,
  busy,
  caseOptions,
  onClose,
  onSave,
}: {
  count: number;
  busy: boolean;
  caseOptions: { priority: CaseOption[]; severity: CaseOption[]; type: CaseOption[] };
  onClose: () => void;
  onSave: (patch: Partial<Record<'priority' | 'severity' | 'type', string>>) => void;
}) {
  const [priority, setPriority] = useState('');
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');

  const patch: Partial<Record<'priority' | 'severity' | 'type', string>> = {};
  if (priority) patch.priority = priority;
  if (severity) patch.severity = severity;
  if (type) patch.type = type;
  const hasChange = Object.keys(patch).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[400px] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">
            Edit {count} case{count === 1 ? '' : 's'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Only the fields you change here are applied — leave a field on &quot;No change&quot; to
          skip it.
        </p>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Priority</span>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value)}
              className={MODAL_SELECT_CLS}
            >
              <option value="">No change</option>
              {caseOptions.priority.map(p => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Severity</span>
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value)}
              className={MODAL_SELECT_CLS}
            >
              <option value="">No change</option>
              {caseOptions.severity.map(s => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Type</span>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className={MODAL_SELECT_CLS}
            >
              <option value="">No change</option>
              {caseOptions.type.map(t => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => hasChange && onSave(patch)}
            disabled={busy || !hasChange}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function OwnerAvatar({ user }: { user: UserSummary | null | undefined }) {
  if (!user) {
    return (
      <div
        className="avatar sm"
        title="Unassigned"
        style={{
          background: 'transparent',
          border: '1px dashed var(--bdr-3)',
          color: 'var(--t-4)',
        }}
      >
        —
      </div>
    );
  }
  const label = user.name || user.username || user.email || '?';
  return (
    <div
      className="avatar sm"
      title={`${label} (${user.email})`}
      style={{
        background: user.avatarUrl ? 'transparent' : avatarGradient(user.id),
        overflow: 'hidden',
      }}
    >
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.avatarUrl}
          alt={label}
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : (
        initials(label)
      )}
    </div>
  );
}

// ─── Filter select ───────────────────────────────────────────
// Looks like the mockup's `<select class="select btn-sm">` but keeps the
// app's multi-select behaviour (a popover of checkboxes) — a native <select>
// can only hold one value.

interface FilterOption<T extends string> {
  value: T;
  label: string;
}

interface FilterSelectProps<T extends string> {
  label: string;
  /** Text shown when nothing is selected, e.g. "All statuses". */
  allLabel: string;
  width: number;
  options: FilterOption<T>[];
  selected: Set<T>;
  onToggle: (value: T) => void;
  onClear: () => void;
  isOpen: boolean;
  onOpen: () => void;
}

function FilterSelect<T extends string>({
  label,
  allLabel,
  width,
  options,
  selected,
  onToggle,
  onClear,
  isOpen,
  onOpen,
}: FilterSelectProps<T>) {
  const count = selected.size;
  const text =
    count === 0
      ? allLabel
      : count === 1
        ? (options.find(o => o.value === Array.from(selected)[0])?.label ?? allLabel)
        : `${label} · ${count}`;
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="select btn-sm"
        onClick={onOpen}
        style={{
          width,
          padding: '6px 28px 6px 10px',
          fontSize: 12,
          textAlign: 'left',
          cursor: 'pointer',
          ...(count > 0 ? { borderColor: 'var(--brand-500)', color: 'var(--brand-800)' } : null),
        }}
      >
        {text}
      </button>
      {isOpen && (
        <div className="fpop">
          {options.map(opt => {
            const checked = selected.has(opt.value);
            return (
              <label key={opt.value}>
                <button
                  type="button"
                  className={cn('cb', checked && 'on')}
                  onClick={() => onToggle(opt.value)}
                >
                  <Ico name="check" />
                </button>
                <span>{opt.label}</span>
              </label>
            );
          })}
          {count > 0 && (
            <label
              style={{ borderTop: '1px solid var(--bdr)', marginTop: 4, color: 'var(--brand-700)' }}
            >
              <button
                type="button"
                onClick={onClear}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                Clear selection
              </button>
            </label>
          )}
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
