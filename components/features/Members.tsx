'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { avatarColour, cn, initials } from '@/lib/utils';
import { SessionUser } from '@/hooks/useStore';

type Role = 'SuperAdmin' | 'QAManager' | 'Tester' | 'Developer' | 'Viewer';
type MemberStatus = 'Active' | 'Pending';

interface Member {
  id: string;
  username: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: Role;
  status: MemberStatus;
  createdAt: string;
  lastActiveAt: string | null;
}

interface MembersPayload {
  items: Member[];
  counts: { total: number; active: number; pending: number; seatsLeft: number };
  plan: { name: string; seats: number };
}

const ROLES: Role[] = ['SuperAdmin', 'QAManager', 'Tester', 'Developer', 'Viewer'];

const ROLE_LABEL: Record<Role, string> = {
  SuperAdmin: 'Super Admin',
  QAManager: 'QA Manager',
  Tester: 'Tester',
  Developer: 'Developer',
  Viewer: 'Viewer',
};

const ROLE_PILL: Record<Role, string> = {
  SuperAdmin: 'bg-purple-50 text-purple-700 ring-purple-200',
  QAManager: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  Tester: 'bg-blue-50 text-blue-700 ring-blue-200',
  Developer: 'bg-orange-50 text-orange-700 ring-orange-200',
  Viewer: 'bg-slate-100 text-slate-600 ring-slate-200',
};

type TabKey = 'all' | 'active' | 'pending';

export function Members({
  currentUser,
  workspaceId,
  workspaceName,
}: {
  currentUser: SessionUser | null;
  workspaceId: string | null;
  workspaceName: string;
}) {
  const [data, setData] = useState<MembersPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!workspaceId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<MembersPayload & { myRole: Role }>(
        `/api/members?projectId=${workspaceId}`,
      );
      setData(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Caller-side capability flags driven by Membership.role in this workspace.
  const myRole = (data as MembersPayload & { myRole?: Role })?.myRole ?? null;
  const canManage = myRole === 'QAManager' || myRole === 'SuperAdmin';
  const canRemove = myRole === 'SuperAdmin';

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.items;
    if (tab === 'active') rows = rows.filter(r => r.status === 'Active');
    if (tab === 'pending') rows = rows.filter(r => r.status === 'Pending');
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        r =>
          (r.name || '').toLowerCase().includes(q) ||
          r.username.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [data, tab, search]);

  // ─── Mutations ───────────────────────────────────────────
  const onChangeRole = async (id: string, role: Role) => {
    try {
      await api.patch(`/api/users/${id}`, { role });
      await reload();
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`);
    }
  };

  const onRemove = async (m: Member) => {
    if (!window.confirm(`Remove ${m.name || m.email} from the workspace?`)) return;
    try {
      await api.del(`/api/users/${m.id}`);
      await reload();
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`);
    }
  };

  // ─── Render ──────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">
              Members
            </h1>
            <p className="text-[13px] text-text-2">
              Manage who has access to this workspace and what they can do.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            disabled={!canManage}
            title={canManage ? '' : 'Requires QA Manager or higher'}
            className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-[7px] text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i className="ti ti-user-plus text-[15px]" />
            Invite member
          </button>
        </div>

        {/* KPI cards */}
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard icon="ti-users" label="Members" value={data?.counts.total ?? 0} />
          <KpiCard
            icon="ti-clock"
            label="Pending"
            value={data?.counts.pending ?? 0}
            valueClass={(data?.counts.pending ?? 0) > 0 ? 'text-amber-700' : 'text-text'}
          />
          <KpiCard
            icon="ti-armchair"
            label="Seats left"
            value={data?.counts.seatsLeft ?? 0}
            valueClass={(data?.counts.seatsLeft ?? 1) === 0 ? 'text-red-700' : 'text-text'}
          />
          <KpiCard
            icon="ti-receipt"
            label="Plan"
            value={data ? `${data.plan.name} · ${data.plan.seats}` : '—'}
            small
          />
        </div>

        {error && (
          <div className="mb-3 rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12.5px] text-danger-text">
            {error}
          </div>
        )}

        {/* Tabs + Search */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Tab
              active={tab === 'all'}
              onClick={() => setTab('all')}
              label="All"
              count={data?.counts.total ?? 0}
            />
            <Tab
              active={tab === 'active'}
              onClick={() => setTab('active')}
              label="Active"
              count={data?.counts.active ?? 0}
            />
            <Tab
              active={tab === 'pending'}
              onClick={() => setTab('pending')}
              label="Pending"
              count={data?.counts.pending ?? 0}
            />
          </div>
          <div className="relative w-[220px]">
            <i className="ti ti-search pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-text-3" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search members…"
              className="w-full rounded-[7px] border border-border bg-surface py-1.5 pl-8 pr-3 text-[12px] text-text outline-none placeholder:text-text-3 focus:border-primary focus:ring-[3px] focus:ring-primary-light"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-2">
              <tr>
                <Th>Member</Th>
                <Th width="160px">Role</Th>
                <Th width="140px">Last active</Th>
                <Th width="120px">Status</Th>
                <th className="w-[40px] border-b border-border px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-3">
                    Loading members…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-text-3">
                    {search ? 'No members match this search.' : 'No members yet.'}
                  </td>
                </tr>
              ) : (
                filtered.map(m => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    currentUserId={currentUser?.id ?? ''}
                    currentUserRole={(currentUser?.role as Role) ?? 'Viewer'}
                    canManage={canManage}
                    canRemove={canRemove}
                    onChangeRole={role => onChangeRole(m.id, role)}
                    onRemove={() => onRemove(m)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showInvite && workspaceId && (
        <InviteDialog
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          currentUserRole={(currentUser?.role as Role) ?? 'Viewer'}
          onClose={() => setShowInvite(false)}
          onInvited={async () => {
            await reload();
          }}
        />
      )}
    </div>
  );
}

// ─── Member row with inline role edit + overflow menu ────────

function MemberRow({
  member,
  currentUserId,
  currentUserRole,
  canManage,
  canRemove,
  onChangeRole,
  onRemove,
}: {
  member: Member;
  currentUserId: string;
  currentUserRole: Role;
  canManage: boolean;
  canRemove: boolean;
  onChangeRole: (role: Role) => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingRole, setEditingRole] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const isSelf = member.id === currentUserId;
  // SuperAdmin can only be touched by another SuperAdmin.
  const isProtected = (member.role === 'SuperAdmin' && currentUserRole !== 'SuperAdmin') || isSelf;
  const canEditRole = canManage && !isProtected;

  const labelName = member.name || member.username;

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-surface-2">
      {/* Member cell */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          {member.status === 'Pending' ? (
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-border-strong text-text-3">
              <i className="ti ti-mail text-[14px]" />
            </span>
          ) : (
            <span
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold',
                avatarColour(member.id),
              )}
            >
              {initials(labelName)}
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate font-medium text-text">
              {labelName || member.email}
              {isSelf && (
                <span className="ml-1 rounded bg-surface-2 px-1.5 py-px text-[10px] font-normal text-text-3">
                  you
                </span>
              )}
            </div>
            <div className="truncate text-[11px] text-text-3">
              {member.status === 'Pending' ? `Invited ${timeAgo(member.createdAt)}` : member.email}
            </div>
          </div>
        </div>
      </td>

      {/* Role cell — inline editor if allowed, otherwise read-only pill */}
      <td className="px-3 py-2.5">
        {editingRole ? (
          <select
            autoFocus
            value={member.role}
            onChange={e => {
              const v = e.target.value as Role;
              setEditingRole(false);
              if (v !== member.role) onChangeRole(v);
            }}
            onBlur={() => setEditingRole(false)}
            className="rounded border border-border bg-surface px-2 py-1 text-[12px] outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
          >
            {ROLES.filter(r => r !== 'SuperAdmin' || currentUserRole === 'SuperAdmin').map(r => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            disabled={!canEditRole}
            onClick={() => setEditingRole(true)}
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider ring-1 transition-colors',
              ROLE_PILL[member.role],
              canEditRole ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
            )}
            title={
              canEditRole
                ? 'Click to change role'
                : isSelf
                  ? "You can't change your own role"
                  : isProtected
                    ? 'Protected role'
                    : 'Insufficient permissions'
            }
          >
            {ROLE_LABEL[member.role]}
          </button>
        )}
      </td>

      {/* Last active */}
      <td className="px-3 py-2.5 text-text-2">
        {member.lastActiveAt ? (
          timeAgo(member.lastActiveAt)
        ) : (
          <span className="text-text-3">—</span>
        )}
      </td>

      {/* Status */}
      <td className="px-3 py-2.5">
        {member.status === 'Active' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            Pending
          </span>
        )}
      </td>

      {/* Overflow menu */}
      <td className="relative px-2 py-2.5 text-right">
        <div className="relative inline-block" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text"
            title="More actions"
          >
            <i className="ti ti-dots-vertical text-[14px]" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-[180px] rounded-lg border border-border bg-surface py-1 text-left shadow-[0_4px_24px_-4px_rgba(28,25,23,0.12)]">
              <MenuItem
                icon="ti-clipboard"
                label="Copy email"
                onClick={() => {
                  navigator.clipboard?.writeText(member.email);
                  setMenuOpen(false);
                }}
              />
              {canEditRole && (
                <MenuItem
                  icon="ti-pencil"
                  label="Change role"
                  onClick={() => {
                    setEditingRole(true);
                    setMenuOpen(false);
                  }}
                />
              )}
              {canRemove && !isSelf && (
                <MenuItem
                  icon="ti-trash"
                  label="Remove from workspace"
                  danger
                  onClick={() => {
                    setMenuOpen(false);
                    onRemove();
                  }}
                />
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Invite dialog ───────────────────────────────────────────

function InviteDialog({
  workspaceId,
  workspaceName,
  currentUserRole,
  onClose,
  onInvited,
}: {
  workspaceId: string;
  workspaceName: string;
  currentUserRole: Role;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('Tester');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // After a successful POST we render the share-link view inside the same dialog.
  const [shared, setShared] = useState<{ email: string; role: Role; acceptUrl: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (busy) return;
    setErr(null);
    if (!email.trim()) {
      setErr('Email is required');
      return;
    }
    try {
      setBusy(true);
      const res = await api.post<{
        email: string;
        role: Role;
        acceptUrl: string;
      }>(`/api/projects/${workspaceId}/invites`, {
        email: email.trim(),
        role,
      });
      // Compose a full URL so it's pasteable into chat.
      const fullUrl =
        typeof window !== 'undefined' ? `${window.location.origin}${res.acceptUrl}` : res.acceptUrl;
      setShared({ email: res.email, role: res.role, acceptUrl: fullUrl });
      onInvited();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!shared) return;
    try {
      await navigator.clipboard.writeText(shared.acceptUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this invite link', shared.acceptUrl);
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
              {shared ? 'Invite ready' : 'Invite to ' + workspaceName}
            </h3>
            <p className="mt-0.5 text-[11.5px] text-text-3">
              {shared
                ? 'Share this link with your teammate — they can sign up & join in one go.'
                : 'They’ll get a shareable link that auto-creates their account on accept.'}
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

        {shared ? (
          /* ── Success view: shareable link ───────────────────────── */
          <div className="space-y-3 px-5 py-4">
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">
              Invite created for <span className="font-mono font-semibold">{shared.email}</span> as{' '}
              <span className="font-semibold">{ROLE_LABEL[shared.role]}</span>.
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
                Invite link
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shared.acceptUrl}
                  onFocus={e => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded border border-border bg-surface-2/40 px-2 py-1.5 font-mono text-[11.5px] text-text outline-none"
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-2 hover:bg-surface-2"
                >
                  <i
                    className={cn(
                      'ti',
                      copied ? 'ti-check text-emerald-600' : 'ti-clipboard',
                      'text-[13px]',
                    )}
                  />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-text-3">
                Link expires in 7 days. Send it via email, Slack, or any chat &mdash; once they open
                it, they sign up with this email and join automatically.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShared(null);
                  setEmail('');
                }}
                className="rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-2"
              >
                Invite another
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-[7px] bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-hover"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ── Form view ─────────────────────────────────────────── */
          <>
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
                  Email
                </label>
                <input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="person@example.com"
                  className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                  onKeyDown={e => {
                    if (e.key === 'Enter') submit();
                  }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
                  Role
                </label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value as Role)}
                  className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                >
                  {ROLES.filter(r => r !== 'SuperAdmin' || currentUserRole === 'SuperAdmin').map(
                    r => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ),
                  )}
                </select>
                <p className="mt-1 text-[11px] text-text-3">{ROLE_HINTS[role]}</p>
              </div>

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
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
                <i className="ti ti-link text-[13px]" />
                Create invite link
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const ROLE_HINTS: Record<Role, string> = {
  SuperAdmin: 'Full admin — can manage members, billing, and all data.',
  QAManager: 'Manage projects, portals, cycles. Cannot remove other admins.',
  Tester: 'Create/edit test cases, execute runs.',
  Developer: 'Read test cases and run results; comment on failures.',
  Viewer: 'Read-only access — no edits.',
};

// ─── Small visual atoms ──────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  valueClass,
  small,
}: {
  icon: string;
  label: string;
  value: number | string;
  valueClass?: string;
  small?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-3">
        <i className={cn('ti', icon, 'text-[16px]')} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">{label}</p>
        <p
          className={cn(
            small
              ? 'text-[15px] font-semibold leading-snug'
              : 'text-[22px] font-semibold leading-tight',
            valueClass ?? 'text-text',
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12.5px] transition-colors',
        active
          ? 'border border-primary bg-primary-light font-semibold text-primary-text'
          : 'border border-border bg-surface text-text-2 hover:bg-surface-2',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-px text-[10px]',
          active ? 'bg-primary/15 text-primary-text' : 'bg-surface-2 text-text-3',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function Th({ children, width }: { children: React.ReactNode; width?: string }) {
  return (
    <th
      style={width ? { width } : undefined}
      className="border-b border-border px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-text-3"
    >
      {children}
    </th>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors',
        danger ? 'text-danger hover:bg-danger-bg' : 'text-text hover:bg-surface-2',
      )}
    >
      <i className={cn('ti', icon, 'text-[13px]')} />
      {label}
    </button>
  );
}

// ─── time-ago ────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'Just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
