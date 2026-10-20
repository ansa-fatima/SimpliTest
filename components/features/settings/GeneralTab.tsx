'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { cn, relativeTime } from '@/lib/utils';
import { SIco } from '@/components/layout/sts-icons';
import type { Project } from '@/types';
import { ProjectIcon } from '../ProjectIcon';
import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  PROJECT_VISIBILITIES,
  normaliseCaseKey,
} from '@/lib/projectIdentity';
import '../sts-v3.css';

interface ProjectGeneral {
  name: string;
  slug: string;
  updatedAt: string;
  defaultEnvironment: string | null;
  defaultPlatform: string | null;
  id?: string;
  description: string;
  color: string | null;
  icon: string | null;
  caseKey: string | null;
  visibility: string;
}
interface Opt {
  key: string;
  name: string;
}
interface TreeSuite {
  _count?: { testCases?: number };
  children?: TreeSuite[];
}
interface TreePortal {
  id: string;
  name: string;
  modules: {
    id: string;
    name: string;
    suites?: TreeSuite[];
    _count?: { suites: number; testCases?: number };
  }[];
}

// A module's case count includes everything nested under its suites.
function suiteCases(ss: TreeSuite[] | undefined): number {
  return (ss ?? []).reduce((n, s) => n + (s._count?.testCases ?? 0) + suiteCases(s.children), 0);
}

// Screen 19 — Project settings › General: identity, the module list and the
// danger zone, laid out like the mockup. Icon/colour/visibility/description
// pickers are in the design but have no backing fields yet, so they're left out.
export function GeneralTab({
  workspaceId,
  canEdit,
  onManageModules,
  onDeleteProject,
  canDelete,
  isOwner,
  onSaved,
}: {
  workspaceId: string;
  canEdit: boolean;
  onManageModules: () => void;
  onDeleteProject: (id: string) => void | Promise<void>;
  /** A workspace can only be deleted while the user has another one to land on. */
  canDelete: boolean;
  /** Only a workspace SuperAdmin may delete it (the API enforces the same). */
  isOwner: boolean;
  /** Called after a successful save so the shell can refresh the workspace list. */
  onSaved?: () => void;
}) {
  const [data, setData] = useState<ProjectGeneral | null>(null);
  const [name, setName] = useState('');
  const [defaultEnvironment, setDefaultEnvironment] = useState('');
  const [defaultPlatform, setDefaultPlatform] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [caseKey, setCaseKey] = useState('');
  const [visibility, setVisibility] = useState('Internal');
  const [showSlug, setShowSlug] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [envs, setEnvs] = useState<Opt[]>([]);
  const [platforms, setPlatforms] = useState<Opt[]>([]);
  const [portals, setPortals] = useState<TreePortal[]>([]);
  const [summary, setSummary] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () =>
    api.get<ProjectGeneral>(`/api/projects/${workspaceId}`).then(p => {
      setData(p);
      setName(p.name);
      setDefaultEnvironment(p.defaultEnvironment ?? '');
      setDefaultPlatform(p.defaultPlatform ?? '');
      setDescription(p.description ?? '');
      setColor(p.color);
      setIcon(p.icon);
      setCaseKey(p.caseKey ?? '');
      setVisibility(p.visibility ?? 'Internal');
    });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch(e => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    api
      .get<{ options: Opt[] }>(`/api/projects/${workspaceId}/options/Environment`)
      .then(r => !cancelled && setEnvs(r.options))
      .catch(() => {});
    api
      .get<{ options: Opt[] }>(`/api/projects/${workspaceId}/options/Platform`)
      .then(r => !cancelled && setPlatforms(r.options))
      .catch(() => {});
    api
      .get<TreePortal[]>(`/api/portals?projectId=${workspaceId}`)
      .then(r => !cancelled && setPortals(r))
      .catch(() => {});
    api
      .get<Project[]>('/api/projects')
      .then(list => !cancelled && setSummary(list.find(p => p.id === workspaceId) ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const dirty =
    !!data &&
    (name !== data.name ||
      defaultEnvironment !== (data.defaultEnvironment ?? '') ||
      defaultPlatform !== (data.defaultPlatform ?? '') ||
      description !== (data.description ?? '') ||
      color !== data.color ||
      icon !== data.icon ||
      caseKey !== (data.caseKey ?? '') ||
      visibility !== (data.visibility ?? 'Internal'));

  const save = async () => {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await api.patch(`/api/projects/${workspaceId}`, {
        name,
        defaultEnvironment: defaultEnvironment || null,
        defaultPlatform: defaultPlatform || null,
        description,
        color,
        icon,
        caseKey: caseKey || null,
        visibility,
      });
      await load();
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (!data) return;
    setName(data.name);
    setDefaultEnvironment(data.defaultEnvironment ?? '');
    setDefaultPlatform(data.defaultPlatform ?? '');
    setDescription(data.description ?? '');
    setColor(data.color);
    setIcon(data.icon);
    setCaseKey(data.caseKey ?? '');
    setVisibility(data.visibility ?? 'Internal');
    setError(null);
    setSaved(false);
  };

  const modules = useMemo(
    () =>
      portals.flatMap(p =>
        p.modules.map(m => ({
          id: m.id,
          name: m.name,
          portal: p.name,
          suites: m._count?.suites ?? 0,
          cases: (m._count?.testCases ?? 0) + suiteCases(m.suites),
        })),
      ),
    [portals],
  );

  const optionList = (opts: Opt[], current: string) =>
    current && !opts.some(o => o.name === current)
      ? [...opts, { key: current, name: current }]
      : opts;

  if (loading || !data) return <div className="empty-note">Loading…</div>;

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Permanently delete "${data.name}" and ALL its data?\n\nThis cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await onDeleteProject(workspaceId);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <h3>Project identity</h3>
          <button
            type="button"
            className="btn-link"
            style={{ fontSize: 12 }}
            onClick={() => setShowSlug(s => !s)}
          >
            {showSlug ? 'Hide URL slug' : 'Show URL slug'}
          </button>
        </div>
        <div className="card-pad-lg">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr',
              gap: 24,
              marginBottom: 18,
              alignItems: 'flex-start',
            }}
          >
            <div>
              <label className="label" style={{ marginBottom: 8 }}>
                Icon
              </label>
              <ProjectIcon
                project={{ id: workspaceId, name: name || data.name, color, icon }}
                size={80}
                radius="var(--r-lg)"
                fontSize={32}
              />
            </div>
            <div>
              <label className="label">Choose color</label>
              <div style={{ display: 'flex', gap: 8, margin: '6px 0 18px', flexWrap: 'wrap' }}>
                {PROJECT_COLORS.map(c => (
                  <button
                    key={c.key}
                    type="button"
                    title={c.key}
                    aria-label={`Color ${c.key}`}
                    disabled={!canEdit}
                    className={cn('color-chip', color === c.key && 'selected')}
                    style={{ background: c.gradient }}
                    onClick={() => setColor(c.key)}
                  />
                ))}
              </div>
              <label className="label">Letter or icon</label>
              <div className="icon-grid" style={{ marginTop: 6 }}>
                {PROJECT_ICONS.map(i => {
                  const selected = (icon ?? 'letter') === i.key;
                  return (
                    <button
                      key={i.key}
                      type="button"
                      title={i.key}
                      aria-label={`Icon ${i.key}`}
                      disabled={!canEdit}
                      className={cn('icon-tile', selected && 'selected')}
                      style={
                        i.path === null
                          ? { fontWeight: 700, fontFamily: 'var(--f-sans)', fontSize: 13 }
                          : undefined
                      }
                      onClick={() => setIcon(i.key === 'letter' ? null : i.key)}
                    >
                      {i.path === null ? (
                        (name.trim() || data.name).charAt(0).toUpperCase()
                      ) : (
                        <svg viewBox="0 0 24 24">
                          <path d={i.path} />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="form-grid">
            <div className="field span-2">
              <label className="label">
                Project name <span className="req">*</span>
              </label>
              <input
                className="input"
                value={name}
                disabled={!canEdit}
                onChange={e => setName(e.target.value)}
              />
            </div>
            {showSlug && (
              <div className="field span-2">
                <label className="label">
                  URL slug <span className="hint">generated from the name when created</span>
                </label>
                <input
                  className="input"
                  value={data.slug}
                  readOnly
                  disabled
                  style={{ fontFamily: 'var(--f-mono)' }}
                />
              </div>
            )}
            <div className="field">
              <label className="label">
                Project key <span className="hint">short code · shown on project cards</span>
              </label>
              <input
                className="input"
                value={caseKey}
                disabled={!canEdit}
                maxLength={8}
                placeholder="e.g. LMS"
                onChange={e => setCaseKey(normaliseCaseKey(e.target.value))}
                style={{ fontFamily: 'var(--f-mono)' }}
              />
            </div>
            <div className="field">
              <label className="label">Visibility</label>
              <select
                className="select"
                value={visibility}
                disabled={!canEdit}
                onChange={e => setVisibility(e.target.value)}
              >
                {PROJECT_VISIBILITIES.map(v => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">
                Default environment <span className="hint">prefills new runs</span>
              </label>
              <select
                className="select"
                value={defaultEnvironment}
                disabled={!canEdit}
                onChange={e => setDefaultEnvironment(e.target.value)}
              >
                <option value="">Not set</option>
                {optionList(envs, defaultEnvironment).map(o => (
                  <option key={o.key} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">
                Default platform <span className="hint">prefills new runs</span>
              </label>
              <select
                className="select"
                value={defaultPlatform}
                disabled={!canEdit}
                onChange={e => setDefaultPlatform(e.target.value)}
              >
                <option value="">Not set</option>
                {optionList(platforms, defaultPlatform).map(o => (
                  <option key={o.key} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field span-2">
              <label className="label">Description</label>
              <textarea
                className="textarea"
                value={description}
                disabled={!canEdit}
                maxLength={500}
                placeholder="What is this project about?"
                onChange={e => setDescription(e.target.value)}
              />
            </div>
          </div>
          {error && (
            <div className="login-error" style={{ marginTop: 16, marginBottom: 0 }}>
              {error}
            </div>
          )}
        </div>
        <div className="card-foot">
          <span style={{ fontSize: 12, color: 'var(--t-3)' }}>
            {saved && !error ? (
              <b style={{ color: 'var(--ok)' }}>Saved ✓</b>
            ) : (
              <>Last edited {relativeTime(data.updatedAt)}</>
            )}
          </span>
          {canEdit ? (
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!dirty || saving}
                onClick={discard}
              >
                Discard
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!dirty || saving || !name.trim()}
                onClick={save}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          ) : (
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--t-3)' }}>
              Only workspace admins can edit these settings.
            </span>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <h3>Modules · {modules.length}</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onManageModules}>
            <SIco name="settings" /> Manage modules
          </button>
        </div>
        <div style={{ padding: 6 }}>
          {modules.length === 0 ? (
            <div className="empty-note" style={{ padding: '28px 12px' }}>
              No modules yet — add portals and modules from Manage modules.
            </div>
          ) : (
            <>
              <div className="mod-row mod-head">
                <span>Module</span>
                <span>Portal</span>
                <span>Suites</span>
                <span>Cases</span>
              </div>
              {modules.map((m, i) => (
                <div
                  key={m.id}
                  className="mod-row"
                  style={i === modules.length - 1 ? { borderBottom: 'none' } : undefined}
                >
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--t-1)' }}>{m.name}</div>
                  <span style={{ fontSize: 12, color: 'var(--t-3)' }}>{m.portal}</span>
                  <span className="mono">{m.suites}</span>
                  <span className="mono">{m.cases ?? '—'}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div id="danger-zone" className="card" style={{ borderColor: 'var(--err-bdr)' }}>
        <div
          className="card-head"
          style={{ background: 'var(--err-bg)', borderColor: 'var(--err-bdr)' }}
        >
          <h3 style={{ color: 'var(--err)' }}>
            <SIco name="alert" /> Danger zone
          </h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 22px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--err)', marginBottom: 2 }}>
              Delete workspace permanently
            </div>
            <div style={{ fontSize: 12, color: 'var(--t-3)' }}>
              {summary ? (
                <>
                  Removes {(summary.caseCount ?? 0).toLocaleString()} cases ·{' '}
                  {summary._count?.cycles ?? 0} runs · {summary._count?.portals ?? 0} portals.{' '}
                </>
              ) : (
                'Removes every case, run and portal in this workspace. '
              )}
              <b style={{ color: 'var(--err)' }}>This cannot be undone.</b>
              {!isOwner && ' Only a workspace Super Admin can delete it.'}
              {isOwner &&
                !canDelete &&
                ' You need at least one other workspace to switch to first.'}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!canEdit || !isOwner || !canDelete || deleting}
            onClick={handleDelete}
          >
            {deleting ? 'Deleting…' : 'Delete workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
