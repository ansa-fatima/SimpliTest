'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';
import { ConfigList, ConfigListItem } from './ConfigList';

interface ModuleRow {
  id: string;
  name: string;
  portalName: string;
  suiteCount: number;
}

interface PortalRow {
  id: string;
  name: string;
  moduleCount: number;
}

interface RawModule {
  id: string;
  name: string;
  _count: { suites: number };
}
interface RawPortal {
  id: string;
  name: string;
  modules: RawModule[];
  _count: { modules: number };
}

export function ProjectsTab({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const [portals, setPortals] = useState<PortalRow[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [versions, setVersions] = useState<ConfigListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setError(null);
    try {
      const [portalRows, versionRows] = await Promise.all([
        api.get<RawPortal[]>(`/api/portals?projectId=${workspaceId}`),
        api.get<{ options: ConfigListItem[] }>(`/api/projects/${workspaceId}/options/Version`),
      ]);
      setPortals(portalRows.map(p => ({ id: p.id, name: p.name, moduleCount: p._count.modules })));
      setModules(
        portalRows.flatMap(p =>
          p.modules.map(m => ({
            id: m.id,
            name: m.name,
            portalName: p.name,
            suiteCount: m._count.suites,
          })),
        ),
      );
      setVersions(versionRows.options);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <PortalsCard
        workspaceId={workspaceId}
        canEdit={canEdit}
        portals={portals}
        loading={loading}
        onChanged={reload}
      />
      <ModulesCard modules={modules} canEdit={canEdit} loading={loading} onChanged={reload} />
      <div className="lg:col-span-2">
        <ConfigList
          title="Versions"
          items={versions}
          canEdit={canEdit}
          loading={loading}
          error={error}
          showColor={false}
          emptyLabel="No versions tracked yet."
          onCreate={async ({ name }) => {
            await api.post(`/api/projects/${workspaceId}/options/Version`, { name });
            await reload();
          }}
          onDelete={async key => {
            await api.del(`/api/projects/${workspaceId}/options/Version/${key}`);
            await reload();
          }}
        />
      </div>
    </div>
  );
}

function PortalsCard({
  workspaceId,
  canEdit,
  portals,
  loading,
  onChanged,
}: {
  workspaceId: string;
  canEdit: boolean;
  portals: PortalRow[];
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setErr(null);
    setBusy('create');
    try {
      await api.post('/api/portals', { name: trimmed, projectId: workspaceId });
      setName('');
      setShowAdd(false);
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, label: string) => {
    if (
      !window.confirm(
        `Delete "${label}"? This removes every module, suite, and test case inside it.`,
      )
    )
      return;
    setErr(null);
    setBusy(id);
    try {
      await api.del(`/api/portals/${id}`);
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[13px] font-semibold text-text">Portals</h4>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowAdd(v => !v)}
            className="inline-flex items-center gap-1 rounded-[7px] border border-border bg-surface px-2.5 py-1 text-[11.5px] font-medium text-text hover:bg-surface-2"
          >
            <i className="ti ti-plus text-[13px]" />
            Add
          </button>
        )}
      </div>
      {showAdd && (
        <div className="mb-2 flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()}
            placeholder="Portal name"
            className="flex-1 rounded border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
          />
          <button
            type="button"
            disabled={busy === 'create' || !name.trim()}
            onClick={create}
            className="rounded-[7px] bg-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create
          </button>
        </div>
      )}
      {err && <p className="mb-2 text-[11.5px] text-danger-text">{err}</p>}
      {loading ? (
        <p className="text-[12px] text-text-3">Loading…</p>
      ) : portals.length === 0 ? (
        <p className="text-[12px] text-text-3">No portals yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {portals.map(p => (
            <li key={p.id} className="flex items-center justify-between py-2 text-[12.5px]">
              <span className="text-text">{p.name}</span>
              <span className="flex items-center gap-2 text-text-3">
                {p.moduleCount} module{p.moduleCount === 1 ? '' : 's'}
                {canEdit && (
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={() => remove(p.id, p.name)}
                    title={`Delete "${p.name}"`}
                    className="rounded p-0.5 text-text-3 hover:bg-danger-bg hover:text-danger"
                  >
                    {busy === p.id ? (
                      <i className="ti ti-loader-2 animate-spin text-[12px]" />
                    ) : (
                      <i className="ti ti-x text-[12px]" />
                    )}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModulesCard({
  modules,
  canEdit,
  loading,
  onChanged,
}: {
  modules: ModuleRow[];
  canEdit: boolean;
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Delete "${label}"? This removes every suite and test case inside it.`))
      return;
    setErr(null);
    setBusy(id);
    try {
      await api.del(`/api/modules/${id}`);
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h4 className="mb-2 text-[13px] font-semibold text-text">Modules &amp; Suites</h4>
      <p className="mb-2 text-[11px] text-text-3">
        New modules are added from the test-case tree, where their portal is picked in context.
      </p>
      {err && <p className="mb-2 text-[11.5px] text-danger-text">{err}</p>}
      {loading ? (
        <p className="text-[12px] text-text-3">Loading…</p>
      ) : modules.length === 0 ? (
        <p className="text-[12px] text-text-3">No modules yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {modules.map(m => (
            <li key={m.id} className={cn('flex items-center justify-between py-2 text-[12.5px]')}>
              <span className="text-text">
                {m.name} <span className="text-text-3">— {m.portalName}</span>
              </span>
              <span className="flex items-center gap-2 text-text-3">
                {m.suiteCount} suite{m.suiteCount === 1 ? '' : 's'}
                {canEdit && (
                  <button
                    type="button"
                    disabled={busy === m.id}
                    onClick={() => remove(m.id, m.name)}
                    title={`Delete "${m.name}"`}
                    className="rounded p-0.5 text-text-3 hover:bg-danger-bg hover:text-danger"
                  >
                    {busy === m.id ? (
                      <i className="ti ti-loader-2 animate-spin text-[12px]" />
                    ) : (
                      <i className="ti ti-x text-[12px]" />
                    )}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
