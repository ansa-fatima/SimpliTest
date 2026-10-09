'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

// Settings > Modules & Features -- three-level Portal > Module > Feature
// tree, kept in its own tables (QaPortal / QaModule / QaFeature) so
// editing them never touches the test-case Portal > Module > Suite tree.
// Rendered as a nested outline: each portal expands to its modules, each
// module to its feature chips, with Add/Rename/Delete at every level.

interface QaFeature {
  id: string;
  name: string;
  order: number;
}
interface QaModule {
  id: string;
  name: string;
  order: number;
  features: QaFeature[];
  _count: { features: number };
}
interface QaPortal {
  id: string;
  name: string;
  order: number;
  modules: QaModule[];
  _count: { modules: number };
}

export function ModulesFeaturesCard({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const [portals, setPortals] = useState<QaPortal[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expandedPortals, setExpandedPortals] = useState<Set<string>>(new Set());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  const reload = async () => {
    setErr(null);
    try {
      const rows = await api.get<QaPortal[]>(`/api/qa-portals?projectId=${workspaceId}`);
      setPortals(rows);
      // Default view is collapsed at EVERY level: portals start closed,
      // and opening a portal shows only its module names (also collapsed)
      // so the chip list for 90+ features isn't dumped on the user all
      // at once. Expand/collapse is driven entirely by user clicks after
      // that -- the reload call never touches the sets again.
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const togglePortal = (id: string) =>
    setExpandedPortals(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleModule = (id: string) =>
    setExpandedModules(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // ── Portal CRUD ─────────────────────────────────────
  const [showAddPortal, setShowAddPortal] = useState(false);
  const [newPortalName, setNewPortalName] = useState('');
  const createPortal = async () => {
    const name = newPortalName.trim();
    if (!name) return;
    setBusy('create-portal');
    setErr(null);
    try {
      await api.post('/api/qa-portals', { name, projectId: workspaceId });
      setNewPortalName('');
      setShowAddPortal(false);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const [editingPortalId, setEditingPortalId] = useState<string | null>(null);
  const [editingPortalName, setEditingPortalName] = useState('');
  const renamePortal = async (id: string) => {
    const name = editingPortalName.trim();
    if (!name) return setEditingPortalId(null);
    setBusy(id);
    setErr(null);
    try {
      await api.patch(`/api/qa-portals/${id}`, { name });
      setEditingPortalId(null);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const deletePortal = async (id: string, label: string) => {
    if (!window.confirm(`Delete "${label}"? Every module and feature inside is removed too.`))
      return;
    setBusy(id);
    setErr(null);
    try {
      await api.del(`/api/qa-portals/${id}`);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // ── Module CRUD (per-portal) ───────────────────────
  const [addingModuleFor, setAddingModuleFor] = useState<string | null>(null);
  const [newModuleName, setNewModuleName] = useState('');
  const createModule = async (portalId: string) => {
    const name = newModuleName.trim();
    if (!name) return;
    setBusy('create-mod');
    setErr(null);
    try {
      await api.post('/api/qa-modules', { name, portalId });
      setNewModuleName('');
      setAddingModuleFor(null);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [editingModuleName, setEditingModuleName] = useState('');
  const renameModule = async (id: string) => {
    const name = editingModuleName.trim();
    if (!name) return setEditingModuleId(null);
    setBusy(id);
    setErr(null);
    try {
      await api.patch(`/api/qa-modules/${id}`, { name });
      setEditingModuleId(null);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const deleteModule = async (id: string, label: string) => {
    if (!window.confirm(`Delete "${label}"? Every feature inside is removed too.`)) return;
    setBusy(id);
    setErr(null);
    try {
      await api.del(`/api/qa-modules/${id}`);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // ── Feature CRUD (per-module) ──────────────────────
  const [newFeatureFor, setNewFeatureFor] = useState<Record<string, string>>({});
  const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);
  const [editingFeatureName, setEditingFeatureName] = useState('');
  const addFeature = async (moduleId: string) => {
    const name = (newFeatureFor[moduleId] ?? '').trim();
    if (!name) return;
    setBusy('add-feat-' + moduleId);
    setErr(null);
    try {
      await api.post('/api/qa-features', { name, moduleId });
      setNewFeatureFor(prev => ({ ...prev, [moduleId]: '' }));
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const removeFeature = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await api.del(`/api/qa-features/${id}`);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const renameFeature = async (id: string) => {
    const name = editingFeatureName.trim();
    if (!name) return setEditingFeatureId(null);
    setBusy(id);
    setErr(null);
    try {
      await api.patch(`/api/qa-features/${id}`, { name });
      setEditingFeatureId(null);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // ── Reorder helpers ────────────────────────────────
  // One POST per nudge -- /move swaps the row's `order` with the adjacent
  // sibling. Up/down arrows at every level call the matching endpoint.
  const nudge = async (
    kind: 'portal' | 'module' | 'feature',
    id: string,
    direction: 'up' | 'down',
  ) => {
    setErr(null);
    setBusy('move-' + id);
    try {
      const slug =
        kind === 'portal' ? 'qa-portals' : kind === 'module' ? 'qa-modules' : 'qa-features';
      await api.post(`/api/${slug}/${id}/move`, { direction });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="lg:col-span-2">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h4 className="text-[13px] font-semibold text-text">Portal · Module · Feature</h4>
            <p className="mt-0.5 text-[11px] text-text-3">
              QA taxonomy for cycle logging and Stability. Separate from the test-case tree — Add,
              rename and delete at every level.
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowAddPortal(v => !v)}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text hover:bg-surface-2"
            >
              <i className="ti ti-plus text-[13px]" />
              Add portal
            </button>
          )}
        </div>

        {showAddPortal && (
          <div className="flex gap-2 border-b border-border bg-surface-2 px-4 py-2">
            <input
              autoFocus
              value={newPortalName}
              onChange={e => setNewPortalName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') createPortal();
                if (e.key === 'Escape') {
                  setShowAddPortal(false);
                  setNewPortalName('');
                }
              }}
              placeholder="Portal name (e.g. Admin Web)"
              className="min-w-[200px] flex-1 rounded border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
            />
            <button
              type="button"
              disabled={busy === 'create-portal' || !newPortalName.trim()}
              onClick={createPortal}
              className="rounded-[7px] bg-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddPortal(false);
                setNewPortalName('');
              }}
              className="rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12px] text-text hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        )}

        {err && (
          <p className="border-b border-border bg-danger-bg/40 px-4 py-2 text-[11.5px] text-danger-text">
            {err}
          </p>
        )}

        {loading ? (
          <p className="p-4 text-[12px] text-text-3">Loading…</p>
        ) : portals.length === 0 ? (
          <p className="p-4 text-[12px] text-text-3">
            No portals yet.{canEdit && ' Click "Add portal" to start the tree.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {portals.map(portal => {
              const portalOpen = expandedPortals.has(portal.id);
              return (
                <li key={portal.id}>
                  {/* Portal row */}
                  <div className="flex items-center gap-2 bg-surface-2/60 px-4 py-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => togglePortal(portal.id)}
                      className="flex h-5 w-5 items-center justify-center text-text-3 hover:text-text"
                      title={portalOpen ? 'Collapse' : 'Expand'}
                    >
                      <i
                        className={cn(
                          'ti text-[14px]',
                          portalOpen ? 'ti-chevron-down' : 'ti-chevron-right',
                        )}
                      />
                    </button>
                    <i className="ti ti-folder text-[13px] text-text-3" />
                    {editingPortalId === portal.id ? (
                      <input
                        autoFocus
                        value={editingPortalName}
                        onChange={e => setEditingPortalName(e.target.value)}
                        onBlur={() => renamePortal(portal.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') renamePortal(portal.id);
                          if (e.key === 'Escape') setEditingPortalId(null);
                        }}
                        className="rounded border border-border bg-surface px-2 py-1 text-[12.5px] text-text outline-none focus:border-primary"
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => {
                          setEditingPortalId(portal.id);
                          setEditingPortalName(portal.name);
                        }}
                        className="min-w-0 flex-1 truncate text-left font-semibold text-text hover:text-primary disabled:cursor-text disabled:hover:text-text"
                        title={canEdit ? 'Click to rename' : portal.name}
                      >
                        {portal.name}
                      </button>
                    )}
                    <span className="text-[11px] text-text-3">
                      {portal._count.modules} module{portal._count.modules === 1 ? '' : 's'}
                    </span>
                    {canEdit && (
                      <>
                        <MoveButtons
                          disabled={busy === 'move-' + portal.id}
                          onUp={() => nudge('portal', portal.id, 'up')}
                          onDown={() => nudge('portal', portal.id, 'down')}
                          isFirst={portals[0]?.id === portal.id}
                          isLast={portals[portals.length - 1]?.id === portal.id}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setAddingModuleFor(portal.id);
                            setNewModuleName('');
                            if (!portalOpen) togglePortal(portal.id);
                          }}
                          title="Add module to this portal"
                          className="flex h-6 w-6 items-center justify-center rounded text-text-3 hover:bg-surface-3 hover:text-text"
                        >
                          <i className="ti ti-plus text-[13px]" />
                        </button>
                        <button
                          type="button"
                          disabled={busy === portal.id}
                          onClick={() => deletePortal(portal.id, portal.name)}
                          title={`Delete "${portal.name}"`}
                          className="flex h-6 w-6 items-center justify-center rounded text-text-3 hover:bg-danger-bg hover:text-danger"
                        >
                          {busy === portal.id ? (
                            <i className="ti ti-loader-2 animate-spin text-[12px]" />
                          ) : (
                            <i className="ti ti-trash text-[13px]" />
                          )}
                        </button>
                      </>
                    )}
                  </div>

                  {/* Modules + feature chips */}
                  {portalOpen && (
                    <div>
                      {/* Inline "add module" row */}
                      {addingModuleFor === portal.id && (
                        <div className="flex items-center gap-2 border-t border-dashed border-border bg-surface-2 px-4 py-2 pl-10">
                          <input
                            autoFocus
                            value={newModuleName}
                            onChange={e => setNewModuleName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') createModule(portal.id);
                              if (e.key === 'Escape') {
                                setAddingModuleFor(null);
                                setNewModuleName('');
                              }
                            }}
                            placeholder="Module name"
                            className="min-w-[180px] flex-1 rounded border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                          />
                          <button
                            type="button"
                            disabled={busy === 'create-mod' || !newModuleName.trim()}
                            onClick={() => createModule(portal.id)}
                            className="rounded-[7px] bg-primary px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddingModuleFor(null);
                              setNewModuleName('');
                            }}
                            className="rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[11.5px] text-text hover:bg-surface-2"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {portal.modules.length === 0 && addingModuleFor !== portal.id && (
                        <p className="border-t border-dashed border-border px-4 py-2 pl-10 text-[11.5px] italic text-text-3">
                          No modules yet{canEdit ? ' — click + on the portal row to add one.' : '.'}
                        </p>
                      )}

                      <ul className="divide-y divide-dashed divide-border">
                        {portal.modules.map(mod => {
                          const modOpen = expandedModules.has(mod.id);
                          return (
                            <li key={mod.id}>
                              {/* Module row */}
                              <div className="flex items-center gap-2 px-4 py-1.5 pl-8 text-[12.5px]">
                                <button
                                  type="button"
                                  onClick={() => toggleModule(mod.id)}
                                  className="flex h-5 w-5 items-center justify-center text-text-3 hover:text-text"
                                  title={modOpen ? 'Collapse' : 'Expand'}
                                >
                                  <i
                                    className={cn(
                                      'ti text-[13px]',
                                      modOpen ? 'ti-chevron-down' : 'ti-chevron-right',
                                    )}
                                  />
                                </button>
                                <i className="ti ti-box text-[12px] text-text-3" />
                                {editingModuleId === mod.id ? (
                                  <input
                                    autoFocus
                                    value={editingModuleName}
                                    onChange={e => setEditingModuleName(e.target.value)}
                                    onBlur={() => renameModule(mod.id)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') renameModule(mod.id);
                                      if (e.key === 'Escape') setEditingModuleId(null);
                                    }}
                                    className="rounded border border-border bg-surface px-2 py-1 text-[12.5px] text-text outline-none focus:border-primary"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    disabled={!canEdit}
                                    onClick={() => {
                                      setEditingModuleId(mod.id);
                                      setEditingModuleName(mod.name);
                                    }}
                                    className="min-w-0 flex-1 truncate text-left font-medium text-text hover:text-primary disabled:cursor-text disabled:hover:text-text"
                                    title={canEdit ? 'Click to rename' : mod.name}
                                  >
                                    {mod.name}
                                  </button>
                                )}
                                <span className="text-[11px] text-text-3">
                                  {mod._count.features} feature
                                  {mod._count.features === 1 ? '' : 's'}
                                </span>
                                {canEdit && (
                                  <>
                                    <MoveButtons
                                      disabled={busy === 'move-' + mod.id}
                                      onUp={() => nudge('module', mod.id, 'up')}
                                      onDown={() => nudge('module', mod.id, 'down')}
                                      isFirst={portal.modules[0]?.id === mod.id}
                                      isLast={
                                        portal.modules[portal.modules.length - 1]?.id === mod.id
                                      }
                                    />
                                    <button
                                      type="button"
                                      disabled={busy === mod.id}
                                      onClick={() => deleteModule(mod.id, mod.name)}
                                      title={`Delete "${mod.name}"`}
                                      className="flex h-6 w-6 items-center justify-center rounded text-text-3 hover:bg-danger-bg hover:text-danger"
                                    >
                                      {busy === mod.id ? (
                                        <i className="ti ti-loader-2 animate-spin text-[12px]" />
                                      ) : (
                                        <i className="ti ti-trash text-[13px]" />
                                      )}
                                    </button>
                                  </>
                                )}
                              </div>

                              {/* Feature chips */}
                              {modOpen && (
                                <div className="bg-surface-2 px-4 py-2 pl-14">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {mod.features.length === 0 && (
                                      <span className="text-[11.5px] italic text-text-3">
                                        No features{canEdit ? ' — add one below.' : '.'}
                                      </span>
                                    )}
                                    {mod.features.map(f => (
                                      <span
                                        key={f.id}
                                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-text"
                                      >
                                        {editingFeatureId === f.id ? (
                                          <input
                                            autoFocus
                                            value={editingFeatureName}
                                            onChange={e => setEditingFeatureName(e.target.value)}
                                            onBlur={() => renameFeature(f.id)}
                                            onKeyDown={e => {
                                              if (e.key === 'Enter') renameFeature(f.id);
                                              if (e.key === 'Escape') setEditingFeatureId(null);
                                            }}
                                            className="w-[120px] rounded border border-border bg-surface px-1.5 py-0.5 text-[11.5px] text-text outline-none focus:border-primary"
                                          />
                                        ) : (
                                          <button
                                            type="button"
                                            disabled={!canEdit}
                                            onClick={() => {
                                              setEditingFeatureId(f.id);
                                              setEditingFeatureName(f.name);
                                            }}
                                            className="truncate text-left hover:text-primary disabled:cursor-text disabled:hover:text-text"
                                            title={canEdit ? 'Click to rename' : f.name}
                                          >
                                            {f.name}
                                          </button>
                                        )}
                                        {canEdit && (
                                          <>
                                            <button
                                              type="button"
                                              disabled={
                                                busy === 'move-' + f.id ||
                                                mod.features[0]?.id === f.id
                                              }
                                              onClick={() => nudge('feature', f.id, 'up')}
                                              title="Move left"
                                              className="rounded text-text-3 transition-colors enabled:hover:bg-surface-3 enabled:hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
                                            >
                                              <i className="ti ti-chevron-left text-[11px]" />
                                            </button>
                                            <button
                                              type="button"
                                              disabled={
                                                busy === 'move-' + f.id ||
                                                mod.features[mod.features.length - 1]?.id === f.id
                                              }
                                              onClick={() => nudge('feature', f.id, 'down')}
                                              title="Move right"
                                              className="rounded text-text-3 transition-colors enabled:hover:bg-surface-3 enabled:hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
                                            >
                                              <i className="ti ti-chevron-right text-[11px]" />
                                            </button>
                                            <button
                                              type="button"
                                              disabled={busy === f.id}
                                              onClick={() => removeFeature(f.id)}
                                              title={`Remove "${f.name}"`}
                                              className="rounded text-text-3 hover:bg-danger-bg hover:text-danger"
                                            >
                                              {busy === f.id ? (
                                                <i className="ti ti-loader-2 animate-spin text-[11px]" />
                                              ) : (
                                                <i className="ti ti-x text-[11px]" />
                                              )}
                                            </button>
                                          </>
                                        )}
                                      </span>
                                    ))}
                                    {canEdit && (
                                      <input
                                        value={newFeatureFor[mod.id] ?? ''}
                                        onChange={e =>
                                          setNewFeatureFor(prev => ({
                                            ...prev,
                                            [mod.id]: e.target.value,
                                          }))
                                        }
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            addFeature(mod.id);
                                          }
                                        }}
                                        placeholder="+ Add a feature…"
                                        className="min-w-[140px] flex-1 rounded border border-dashed border-border bg-transparent px-2 py-1 text-[12px] text-text outline-none placeholder:text-text-3 focus:border-primary focus:bg-surface"
                                      />
                                    )}
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// A pair of tightly-stacked up/down arrows. First-row's Up and last-row's
// Down disable themselves, so the user never fires a doomed /move call.
function MoveButtons({
  disabled,
  isFirst,
  isLast,
  onUp,
  onDown,
}: {
  disabled: boolean;
  isFirst: boolean;
  isLast: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <span className="flex flex-shrink-0 items-center">
      <button
        type="button"
        disabled={disabled || isFirst}
        onClick={onUp}
        title="Move up"
        className="flex h-6 w-5 items-center justify-center rounded text-text-3 transition-colors enabled:hover:bg-surface-3 enabled:hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
      >
        <i className="ti ti-chevron-up text-[13px]" />
      </button>
      <button
        type="button"
        disabled={disabled || isLast}
        onClick={onDown}
        title="Move down"
        className="flex h-6 w-5 items-center justify-center rounded text-text-3 transition-colors enabled:hover:bg-surface-3 enabled:hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
      >
        <i className="ti ti-chevron-down text-[13px]" />
      </button>
    </span>
  );
}
