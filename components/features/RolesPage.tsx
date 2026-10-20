'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { cn, initials, relativeTime } from '@/lib/utils';
import { colorClassesOf, PALETTE_COLORS } from '@/lib/colors';
import { SIco } from '@/components/layout/sts-icons';
import { avatarGradient } from './tc-helpers';
import './sts-v3.css';

// A role KEY is a built-in role's own name or a custom WorkspaceRole.id.
type RoleKey = string;
interface RoleInfo {
  key: RoleKey;
  name: string;
  color: string;
  isCustom: boolean;
  isProtected: boolean;
}
interface Member {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  role: RoleKey;
  status: 'Active' | 'Pending';
  lastActiveAt: string | null;
}
interface MembersPayload {
  items: Member[];
  roles: RoleInfo[];
  canManageTeam: boolean;
}

const PERMISSION_KEYS = [
  'viewDashboard',
  'viewReports',
  'manageTestCases',
  'createCycles',
  'executeTests',
  'manageTeamRoles',
  'settings',
] as const;
type PermissionKey = (typeof PERMISSION_KEYS)[number];
type Matrix = Record<PermissionKey, RoleKey[]>;

const PERM_INFO: Record<
  PermissionKey,
  { label: string; desc: string; meta: string; enforced: boolean }
> = {
  viewDashboard: {
    label: 'View Dashboard',
    desc: 'See the workspace overview and its activity feed',
    meta: 'Workspace',
    enforced: false,
  },
  viewReports: {
    label: 'View Reports',
    desc: 'Open reports, analytics and stability views',
    meta: 'Workspace',
    enforced: false,
  },
  manageTestCases: {
    label: 'Manage Test Cases',
    desc: 'Create, edit, move and delete test cases and sections',
    meta: 'Test Cases',
    enforced: false,
  },
  createCycles: {
    label: 'Create Cycles',
    desc: 'Create and edit test runs',
    meta: 'Test Runs',
    enforced: false,
  },
  executeTests: {
    label: 'Execute Tests / Quick Logs',
    desc: 'Give cases a result in a run and log quick logs',
    meta: 'Execution',
    enforced: false,
  },
  manageTeamRoles: {
    label: 'Manage Team & Roles',
    desc: 'Invite members, change roles, reset passwords, edit this page',
    meta: 'Admin',
    enforced: true,
  },
  settings: {
    label: 'Settings',
    desc: 'Edit workspace settings, configuration and integrations',
    meta: 'Admin',
    enforced: true,
  },
};

const GROUPS: { title: string; icon: Parameters<typeof SIco>[0]['name']; keys: PermissionKey[] }[] =
  [
    { title: 'Workspace', icon: 'overview', keys: ['viewDashboard', 'viewReports'] },
    {
      title: 'Test cases & runs',
      icon: 'file',
      keys: ['manageTestCases', 'createCycles', 'executeTests'],
    },
    { title: 'Admin & system', icon: 'settings', keys: ['manageTeamRoles', 'settings'] },
  ];

// What a built-in role starts with -- mirrors lib/permissions.ts (which imports
// the database layer, so it can't be shared with the browser). Custom roles
// start empty: least privilege until an admin grants something.
const TEMPLATE: Record<PermissionKey, RoleKey[]> = {
  viewDashboard: ['SuperAdmin', 'QAManager', 'Tester', 'Developer', 'Viewer'],
  viewReports: ['SuperAdmin', 'QAManager', 'Tester', 'Developer', 'Viewer'],
  manageTestCases: ['SuperAdmin', 'QAManager', 'Tester'],
  createCycles: ['SuperAdmin', 'QAManager'],
  executeTests: ['SuperAdmin', 'QAManager', 'Tester'],
  manageTeamRoles: ['SuperAdmin'],
  settings: ['SuperAdmin', 'QAManager'],
};

// A SuperAdmin unchecking their own Manage Team & Roles would strand the
// workspace -- mirrors lib/permissions.ts's isLockedCell.
const isLocked = (key: PermissionKey, role: RoleKey) =>
  key === 'manageTeamRoles' && role === 'SuperAdmin';

type Tab = 'permissions' | 'users';

// Screen 11 — Admin › Role management: role list, grouped permission editor
// with a pending-change draft, and an impact preview before anything is saved.
export function RolesPage({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string | null;
  workspaceName: string;
}) {
  const [data, setData] = useState<MembersPayload | null>(null);
  const [saved, setSaved] = useState<Matrix | null>(null);
  const [draft, setDraft] = useState<Matrix | null>(null);
  const [selected, setSelected] = useState<RoleKey | null>(null);
  const [tab, setTab] = useState<Tab>('permissions');
  const [query, setQuery] = useState('');
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>('blue');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [m, p] = await Promise.all([
        api.get<MembersPayload>(`/api/members?projectId=${workspaceId}`),
        api.get<{ permissions: Matrix }>(`/api/projects/${workspaceId}/permissions`),
      ]);
      setData(m);
      setSaved(p.permissions);
      setDraft(p.permissions);
      setSelected(cur =>
        cur && m.roles.some(r => r.key === cur) ? cur : (m.roles[0]?.key ?? null),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const roles = data?.roles ?? [];
  const canEdit = data?.canManageTeam ?? false;
  const role = roles.find(r => r.key === selected) ?? null;

  const members = useMemo(() => (data?.items ?? []).filter(m => m.status === 'Active'), [data]);
  const usersOf = (key: RoleKey) => members.filter(m => m.role === key);
  const permCount = (key: RoleKey, m: Matrix | null) =>
    m ? PERMISSION_KEYS.filter(k => m[k].includes(key)).length : 0;

  // Pending diff for the selected role (draft vs what's stored).
  const diff = useMemo(() => {
    if (!role || !saved || !draft) return { granted: [], revoked: [] as PermissionKey[] };
    const granted = PERMISSION_KEYS.filter(
      k => draft[k].includes(role.key) && !saved[k].includes(role.key),
    );
    const revoked = PERMISSION_KEYS.filter(
      k => !draft[k].includes(role.key) && saved[k].includes(role.key),
    );
    return { granted, revoked };
  }, [role, saved, draft]);
  const pending = diff.granted.length + diff.revoked.length;

  const setCell = (key: PermissionKey, roleKey: RoleKey, allowed: boolean) =>
    setDraft(m =>
      m
        ? {
            ...m,
            [key]: allowed
              ? m[key].includes(roleKey)
                ? m[key]
                : [...m[key], roleKey]
              : m[key].filter(r => r !== roleKey),
          }
        : m,
    );

  const toggle = (key: PermissionKey) => {
    if (!role || !canEdit || isLocked(key, role.key) || !draft) return;
    setApplied(false);
    setCell(key, role.key, !draft[key].includes(role.key));
  };

  const filteredKeys = (keys: PermissionKey[]) => {
    const q = query.trim().toLowerCase();
    return q
      ? keys.filter(k => {
          const i = PERM_INFO[k];
          return (
            k.toLowerCase().includes(q) ||
            i.label.toLowerCase().includes(q) ||
            i.desc.toLowerCase().includes(q)
          );
        })
      : keys;
  };

  const allOn = !!role && !!draft && PERMISSION_KEYS.every(k => draft[k].includes(role.key));
  const selectAll = () => {
    if (!role || !canEdit) return;
    setApplied(false);
    PERMISSION_KEYS.forEach(k => {
      if (!isLocked(k, role.key)) setCell(k, role.key, !allOn);
    });
  };
  const resetToTemplate = () => {
    if (!role || !canEdit) return;
    setApplied(false);
    PERMISSION_KEYS.forEach(k => {
      if (!isLocked(k, role.key)) setCell(k, role.key, TEMPLATE[k].includes(role.key));
    });
  };

  const discard = () => {
    setDraft(saved);
    setApplied(false);
    setError(null);
  };

  const select = (key: RoleKey) => {
    if (key === selected) return;
    if (pending > 0 && !window.confirm('Discard your unsaved permission changes?')) return;
    discard();
    setSelected(key);
  };

  const apply = async () => {
    if (!role || pending === 0 || !workspaceId) return;
    setApplying(true);
    setError(null);
    try {
      for (const key of diff.granted)
        await api.patch(`/api/projects/${workspaceId}/permissions`, {
          key,
          role: role.key,
          allowed: true,
        });
      for (const key of diff.revoked)
        await api.patch(`/api/projects/${workspaceId}/permissions`, {
          key,
          role: role.key,
          allowed: false,
        });
      await load();
      setApplied(true);
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setApplying(false);
    }
  };

  const createRole = async () => {
    const name = newName.trim();
    if (!name || creating || !workspaceId) return;
    setCreating(true);
    setError(null);
    try {
      const r = await api.post<{ id?: string; key?: string }>(
        `/api/projects/${workspaceId}/roles`,
        { name, color: newColor },
      );
      setNewName('');
      setShowNew(false);
      await load();
      const key = r.id ?? r.key;
      if (key) setSelected(key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const deleteRole = async () => {
    if (!role || !workspaceId) return;
    if (
      !window.confirm(
        `Delete the "${role.name}" role? Anyone still assigned to it must be moved off first.`,
      )
    )
      return;
    setError(null);
    try {
      await api.del(`/api/projects/${workspaceId}/roles/${role.key}`);
      setSelected(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!workspaceId) {
    return (
      <div className="stv3 main-scroll">
        <div className="empty-note">Select a workspace to manage its roles.</div>
      </div>
    );
  }
  if (!data || !saved || !draft) {
    return <div className="stv3 state-note">{error ?? 'Loading roles…'}</div>;
  }

  const roleUsers = role ? usersOf(role.key) : [];
  const total = PERMISSION_KEYS.length;

  return (
    <div className="stv3 main-scroll">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <span className="crumb">{workspaceName || 'Workspace'}</span>
            <span className="sep">/</span>
            <span className="current">Role management</span>
          </div>
          <h1 className="page-title">
            Role <em>management</em>
          </h1>
          <div className="page-sub">
            Create roles · grant permissions · review the impact before you apply
          </div>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canEdit}
            title={canEdit ? '' : 'Requires the Manage Team & Roles permission'}
            onClick={() => setShowNew(s => !s)}
          >
            <SIco name="plus" /> New role
          </button>
        </div>
      </div>

      {error && (
        <div className="login-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div
        style={{ display: 'grid', gridTemplateColumns: '280px minmax(0,1fr)', gap: 24 }}
        className="roles-layout"
      >
        {/* Role list */}
        <div className="card" style={{ height: 'fit-content' }}>
          <div className="card-head">
            <h3>Roles · {roles.length}</h3>
          </div>
          {showNew && (
            <div
              style={{
                padding: 12,
                borderBottom: '1px solid var(--bdr)',
                background: 'var(--brand-50)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <input
                autoFocus
                className="input"
                value={newName}
                maxLength={40}
                placeholder="e.g. Product Manager"
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') createRole();
                  if (e.key === 'Escape') setShowNew(false);
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  className="select"
                  value={newColor}
                  onChange={e => setNewColor(e.target.value)}
                >
                  {PALETTE_COLORS.map(c => (
                    <option key={c} value={c}>
                      {c[0].toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!newName.trim() || creating}
                  onClick={createRole}
                >
                  {creating ? '…' : 'Create'}
                </button>
              </div>
            </div>
          )}
          <div style={{ padding: 6 }}>
            {roles.map(r => {
              const on = r.key === selected;
              return (
                <button
                  key={r.key}
                  type="button"
                  className={cn('role-item', on && 'on')}
                  onClick={() => select(r.key)}
                >
                  <span className={cn('role-dot', colorClassesOf(r.color).dot)} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="ri-name">
                      {r.name}
                      {r.isCustom && <span className="ri-custom">CUSTOM</span>}
                    </span>
                    <span className="ri-meta">
                      {permCount(r.key, on ? draft : saved)} perms · {usersOf(r.key).length} user
                      {usersOf(r.key).length === 1 ? '' : 's'}
                    </span>
                  </span>
                  {on ? (
                    <span className="pill pill-brand" style={{ padding: '1px 6px', fontSize: 10 }}>
                      EDITING
                    </span>
                  ) : r.isProtected ? (
                    <span
                      style={{ fontSize: 10.5, color: 'var(--t-4)', fontFamily: 'var(--f-mono)' }}
                    >
                      SYSTEM
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor */}
        {role && (
          <div style={{ minWidth: 0 }}>
            <div className="card" style={{ marginBottom: 16 }}>
              <div
                style={{
                  padding: '18px 22px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  borderBottom: '1px solid var(--bdr)',
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 'var(--r-lg)',
                    background: 'linear-gradient(135deg,var(--brand-500),var(--brand-800))',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#fff',
                    fontSize: 18,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {initials(role.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 4,
                      flexWrap: 'wrap',
                    }}
                  >
                    <h2
                      style={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: 'var(--t-1)',
                        letterSpacing: '-0.015em',
                        margin: 0,
                      }}
                    >
                      {role.name}
                    </h2>
                    <span className="pill pill-brand">
                      <span className="dot" /> {permCount(role.key, draft)} of {total} perms
                    </span>
                    {pending > 0 && <span className="pill pill-warn">Unsaved changes</span>}
                    {applied && pending === 0 && <span className="pill pill-ok">Saved ✓</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--t-3)' }}>
                    {role.isProtected
                      ? 'Workspace owner tier — keeps Manage Team & Roles so the workspace can never be locked out.'
                      : role.isCustom
                        ? 'Custom role — starts with no permissions until you grant some.'
                        : 'Built-in role — edit its permissions or reset to the default template.'}
                  </div>
                </div>
                {!role.isProtected && canEdit && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ color: 'var(--err)' }}
                    onClick={deleteRole}
                  >
                    <SIco name="trash" /> Delete
                  </button>
                )}
              </div>

              <div style={{ padding: '0 22px' }}>
                <div className="tabs" style={{ marginBottom: 0 }}>
                  <button
                    type="button"
                    className={cn('tab', tab === 'permissions' && 'active')}
                    onClick={() => setTab('permissions')}
                  >
                    Permissions <span className="badge">{permCount(role.key, draft)}</span>
                  </button>
                  <button
                    type="button"
                    className={cn('tab', tab === 'users' && 'active')}
                    onClick={() => setTab('users')}
                  >
                    Assigned users <span className="badge">{roleUsers.length}</span>
                  </button>
                </div>
              </div>

              {tab === 'permissions' ? (
                <div style={{ padding: '18px 22px' }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                    <div
                      className="topbar-search perm-filter"
                      style={{
                        background: 'var(--c-bg)',
                        border: '1px solid var(--bdr)',
                        maxWidth: 'none',
                        flex: 1,
                        padding: '7px 12px',
                        margin: 0,
                      }}
                    >
                      <SIco name="search" />
                      <input
                        style={{ color: 'var(--t-1)' }}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Filter permissions…"
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!canEdit}
                      onClick={selectAll}
                    >
                      <span className={cn('cb', allOn && 'on')} style={{ marginRight: 4 }}>
                        <svg viewBox="0 0 12 12">
                          <path d="M2 6L5 9L10 3" />
                        </svg>
                      </span>{' '}
                      Select all
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!canEdit}
                      onClick={resetToTemplate}
                    >
                      Reset to template
                    </button>
                  </div>

                  {GROUPS.map(g => {
                    const keys = filteredKeys(g.keys);
                    if (keys.length === 0) return null;
                    const on = g.keys.filter(k => draft[k].includes(role.key)).length;
                    return (
                      <div key={g.title} className="perm-group">
                        <div className="perm-group-head">
                          <SIco name={g.icon} size={13} /> {g.title}
                          <span className="count">
                            {on} / {g.keys.length}
                          </span>
                        </div>
                        <div className="perm-list">
                          {keys.map(k => {
                            const allowed = draft[k].includes(role.key);
                            const locked = isLocked(k, role.key);
                            const interactive = canEdit && !locked;
                            const changed = allowed !== saved[k].includes(role.key);
                            return (
                              <div
                                key={k}
                                className="perm-row"
                                style={{
                                  cursor: interactive ? 'pointer' : 'default',
                                  background: changed ? 'var(--warn-bg)' : undefined,
                                }}
                                title={
                                  locked
                                    ? 'SuperAdmin must always retain Manage Team & Roles'
                                    : undefined
                                }
                                onClick={() => toggle(k)}
                              >
                                <span
                                  className={cn('cb', allowed && 'on')}
                                  style={locked ? { opacity: 0.6 } : undefined}
                                >
                                  <svg viewBox="0 0 12 12">
                                    <path d="M2 6L5 9L10 3" />
                                  </svg>
                                </span>
                                <span className="pkey">{k}</span>
                                <span className="pdesc">
                                  {PERM_INFO[k].desc}
                                  {!PERM_INFO[k].enforced && (
                                    <span className="not-enforced">saved preference</span>
                                  )}
                                </span>
                                <span className="pmeta">{PERM_INFO[k].meta}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <p style={{ fontSize: 11.5, color: 'var(--t-3)', margin: 0, lineHeight: 1.6 }}>
                    <b style={{ color: 'var(--t-2)' }}>Manage Team &amp; Roles</b> and{' '}
                    <b style={{ color: 'var(--t-2)' }}>Settings</b> change real access today. The
                    other permissions are stored as workspace preferences but not yet enforced by
                    the rest of the app.
                  </p>
                </div>
              ) : (
                <div style={{ padding: 6 }}>
                  {roleUsers.length === 0 ? (
                    <div className="empty-note" style={{ padding: '36px 12px' }}>
                      No one has this role yet.
                    </div>
                  ) : (
                    roleUsers.map((m, i) => (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '11px 16px',
                          borderBottom: i < roleUsers.length - 1 ? '1px solid var(--bdr)' : 'none',
                        }}
                      >
                        <div
                          className="avatar"
                          style={{ background: avatarGradient(m.name || m.username) }}
                        >
                          {initials(m.name || m.username)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--t-1)' }}>
                            {m.name || m.username}
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--t-3)' }}>{m.email}</div>
                        </div>
                        <span style={{ fontSize: 11.5, color: 'var(--t-4)' }}>
                          {m.lastActiveAt
                            ? `Active ${relativeTime(m.lastActiveAt)}`
                            : 'Not active yet'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Impact preview */}
            <div
              className="card"
              style={{
                borderColor: 'var(--brand-300)',
                background: 'linear-gradient(180deg,var(--brand-50) 0%,var(--c-surface) 30%)',
              }}
            >
              <div
                className="card-head"
                style={{ background: 'transparent', borderColor: 'var(--brand-bdr)' }}
              >
                <h3 style={{ color: 'var(--brand-800)' }}>
                  <SIco name="info" /> Impact preview · before saving
                </h3>
                <span className="meta">
                  {pending === 0
                    ? 'No pending changes'
                    : `${pending} change${pending === 1 ? '' : 's'} pending`}
                </span>
              </div>
              <div style={{ padding: '16px 22px' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 14,
                    marginBottom: 14,
                  }}
                >
                  <div className="impact-box">
                    <div className="ib-l" style={{ color: 'var(--t-4)' }}>
                      Affected users
                    </div>
                    <div className="ib-v" style={{ color: 'var(--t-1)' }}>
                      {pending === 0 ? 0 : roleUsers.length}
                    </div>
                    <div className="ib-s">
                      Take effect immediately — access is checked on every request
                    </div>
                  </div>
                  <div className="impact-box">
                    <div className="ib-l" style={{ color: 'var(--ok)' }}>
                      ▲ Granted
                    </div>
                    <div className="ib-v" style={{ color: 'var(--ok)' }}>
                      +{diff.granted.length}
                    </div>
                    <div className="ib-s">
                      {diff.granted.length ? diff.granted.join(', ') : 'Nothing new'}
                    </div>
                  </div>
                  <div className="impact-box">
                    <div className="ib-l" style={{ color: 'var(--err)' }}>
                      ▼ Revoked
                    </div>
                    <div className="ib-v" style={{ color: 'var(--err)' }}>
                      −{diff.revoked.length}
                    </div>
                    <div className="ib-s">
                      {diff.revoked.length ? diff.revoked.join(', ') : 'Nothing removed'}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    background: 'var(--c-surface)',
                    border: '1px solid var(--bdr)',
                    borderRadius: 'var(--r)',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <span style={{ fontSize: 11.5, color: 'var(--t-3)' }}>Affected:</span>
                  {roleUsers.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--t-3)' }}>
                      No one is assigned to this role.
                    </span>
                  ) : (
                    <>
                      <div className="avatar-stack">
                        {roleUsers.slice(0, 5).map(m => (
                          <div
                            key={m.id}
                            className="avatar sm"
                            style={{ background: avatarGradient(m.name || m.username) }}
                          >
                            {initials(m.name || m.username)}
                          </div>
                        ))}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--t-2)' }}>
                        {roleUsers
                          .slice(0, 4)
                          .map(m => (m.name || m.username).split(/\s+/)[0])
                          .join(', ')}
                        {roleUsers.length > 4 ? ` +${roleUsers.length - 4} more` : ''}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="card-foot">
                <span style={{ fontSize: 12, color: 'var(--t-3)' }}>
                  {canEdit
                    ? 'Changes apply to everyone in this role as soon as you apply them.'
                    : 'You can view roles, but editing needs the Manage Team & Roles permission.'}
                </span>
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={pending === 0 || applying}
                    onClick={discard}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={pending === 0 || applying || !canEdit}
                    onClick={apply}
                  >
                    <SIco name="check" /> {applying ? 'Applying…' : 'Apply changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
