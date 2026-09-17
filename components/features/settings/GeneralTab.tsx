'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';

interface ProjectGeneral {
  name: string;
  defaultEnvironment: string | null;
  defaultPlatform: string | null;
}

export function GeneralTab({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const [data, setData] = useState<ProjectGeneral | null>(null);
  const [name, setName] = useState('');
  const [defaultEnvironment, setDefaultEnvironment] = useState('');
  const [defaultPlatform, setDefaultPlatform] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ProjectGeneral>(`/api/projects/${workspaceId}`)
      .then(p => {
        if (cancelled) return;
        setData(p);
        setName(p.name);
        setDefaultEnvironment(p.defaultEnvironment ?? '');
        setDefaultPlatform(p.defaultPlatform ?? '');
      })
      .catch(e => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const save = async () => {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await api.patch(`/api/projects/${workspaceId}`, {
        name,
        defaultEnvironment: defaultEnvironment || null,
        defaultPlatform: defaultPlatform || null,
      });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) return <p className="text-[12px] text-text-3">Loading…</p>;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h4 className="mb-3 text-[13px] font-semibold text-text">Product Settings</h4>

      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
        Workspace Name
      </label>
      <input
        value={name}
        disabled={!canEdit}
        onChange={e => setName(e.target.value)}
        className="mb-4 w-full rounded-lg border border-border bg-surface p-2.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-surface-2 disabled:text-text-3"
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
            Default Environment
          </label>
          <input
            value={defaultEnvironment}
            disabled={!canEdit}
            onChange={e => setDefaultEnvironment(e.target.value)}
            placeholder="e.g. Production"
            className="w-full rounded-lg border border-border bg-surface p-2.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-surface-2 disabled:text-text-3"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
            Default Platform
          </label>
          <input
            value={defaultPlatform}
            disabled={!canEdit}
            onChange={e => setDefaultPlatform(e.target.value)}
            placeholder="e.g. Web"
            className="w-full rounded-lg border border-border bg-surface p-2.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-surface-2 disabled:text-text-3"
          />
        </div>
      </div>

      {error && <p className="mt-3 text-[12px] text-danger-text">{error}</p>}
      {saved && !error && <p className="mt-3 text-[12px] text-success">Saved.</p>}

      {canEdit && (
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={save}
          className="mt-4 inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-2 text-[13px] font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving && <i className="ti ti-loader-2 animate-spin text-[14px]" />}
          Save Changes
        </button>
      )}
    </div>
  );
}
