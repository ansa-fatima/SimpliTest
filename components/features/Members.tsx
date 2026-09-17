'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/client';
import { avatarColour, cn, initials } from '@/lib/utils';
import { ActivityEvent } from '@/lib/activity';
import { ActivityFeed } from './ActivityFeed';
import { SessionUser } from '@/hooks/useStore';
import { colorClassesOf, PALETTE_COLORS } from '@/lib/colors';

// A role KEY is either a built-in role's own name or a custom
// (SuperAdmin-created) WorkspaceRole.id -- see lib/roles.ts server-side.
// Never hardcode the 5 built-ins here: always resolve a key's display info
// (name/color) against the `roles` list the server returns, so a custom
// role renders exactly like a built-in one everywhere.
type RoleKey = string;
type MemberStatus = 'Active' | 'Pending';

interface RoleInfo {
  key: RoleKey;
  name: string;
  color: string;
  isCustom: boolean;
  /** SuperAdmin only -- can't be deleted, renamed, or unassigned as the workspace's owner tier. */
  isProtected: boolean;
}

function roleInfoOf(roles: RoleInfo[], key: RoleKey): RoleInfo {
  return (
    roles.find(r => r.key === key) ?? {
      key,
      name: key,
      color: 'slate',
      isCustom: true,
      isProtected: false,
    }
  );
}

interface MemberStats {
  assigned: number;
  executed: number;
  openDefects: number;
}

interface Member {
  id: string;
  username: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: RoleKey;
  status: MemberStatus;
  createdAt: string;
  lastActiveAt: string | null;
  /** Absent for pending-invite rows -- nothing real to show yet. */
  stats?: MemberStats;
  /** Present only for pending-invite rows — id is a synthetic `invite_<id>`, not a real user id. */
  invite?: { token: string; expiresAt: string };
}

interface MembersPayload {
  items: Member[];
  counts: { total: number; active: number; pending: number };
  roles: RoleInfo[];
  recentActivity: ActivityEvent[];
}

type TabKey = 'all' | 'active' | 'pending';

export function Members({
  currentUser,
  workspaceId,
  workspaceName,
  onSelfRoleChanged,
}: {
  currentUser: SessionUser | null;
  workspaceId: string | null;
  workspaceName: string;
  /** Called after the signed-in user changes their OWN role, so the caller
   *  can refresh the session (sidebar) — it doesn't pick this up on its own. */
  onSelfRoleChanged?: () => void;
}) {
  const [data, setData] = useState<MembersPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [resetTarget, setResetTarget] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!workspaceId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<MembersPayload & { myRole: RoleKey; isCreator: boolean }>(
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

  // Caller-side capability flag -- whether the signed-in user currently
  // holds "Manage Team & Roles" (invite, change role, remove, reset
  // password). Checked against the live Permission Matrix server-side, not
  // just "is SuperAdmin", since a SuperAdmin can grant this to another role.
  const myRole = (data as MembersPayload & { myRole?: RoleKey })?.myRole ?? null;
  const canManageTeam =
    (data as MembersPayload & { canManageTeam?: boolean })?.canManageTeam ?? false;
  const isCreator = (data as MembersPayload & { isCreator?: boolean })?.isCreator ?? false;
  const roles = data?.roles ?? [];

  // Real per-role headcount for the Roles & Permissions reference -- active
  // members only, a still-pending invite hasn't actually taken up that role yet.
  const roleCounts = useMemo(() => {
    const counts: Record<RoleKey, number> = {};
    data?.items.forEach(m => {
      if (m.status === 'Active') counts[m.role] = (counts[m.role] ?? 0) + 1;
    });
    return counts;
  }, [data]);

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
  const onChangeRole = async (id: string, role: RoleKey) => {
    try {
      await api.patch(`/api/users/${id}`, { role, projectId: workspaceId });
      await reload();
      if (id === currentUser?.id) onSelfRoleChanged?.();
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`);
    }
  };

  const onRemove = async (m: Member) => {
    // Pending rows carry a synthetic `invite_<id>` id, not a real User id —
    // revoke the invite itself instead of trying to delete a nonexistent user.
    if (m.invite) {
      if (!window.confirm(`Revoke the invite to ${m.email}?`)) return;
      try {
        await api.del(`/api/invites/${m.invite.token}`);
        await reload();
      } catch (e) {
        alert(`Failed: ${(e as Error).message}`);
      }
      return;
    }
    if (!window.confirm(`Remove ${m.name || m.email} from the workspace?`)) return;
    try {
      await api.del(`/api/users/${m.id}?projectId=${workspaceId}`);
      await reload();
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`);
    }
  };

  // ─── Render ──────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-44 py-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">
              Teams
            </h1>
            <p className="text-[13px] text-text-2">
              {data?.counts.total ?? 0} member{(data?.counts.total ?? 0) === 1 ? '' : 's'} in this
              workspace
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowRoles(true)}
              className="text-[12.5px] font-medium text-primary hover:underline"
            >
              Roles &amp; Permissions
            </button>
            <button
              type="button"
              onClick={() => setShowInvite(true)}
              disabled={!canManageTeam}
              title={canManageTeam ? '' : 'Requires the Manage Team & Roles permission'}
              className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-[7px] text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className="ti ti-user-plus text-[15px]" />
              Invite Member
            </button>
          </div>
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

        {/* Member cards */}
        {loading && !data ? (
          <div className="py-12 text-center text-[13px] text-text-3">Loading members…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-text-3">
            {search ? 'No members match this search.' : 'No members yet.'}
          </div>
        ) : (
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map(m => (
              <MemberCard
                key={m.id}
                member={m}
                roles={roles}
                currentUserId={currentUser?.id ?? ''}
                currentUserRole={myRole ?? 'Viewer'}
                canManageTeam={canManageTeam}
                isCreator={isCreator}
                onChangeRole={role => onChangeRole(m.id, role)}
                onRemove={() => onRemove(m)}
                onResetPassword={
                  canManageTeam && m.status === 'Active' ? () => setResetTarget(m) : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Recent Team Activity — same two real event kinds as the Dashboard's
            own feed (a test run given a verdict, a quick log logged). */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-[13.5px] font-semibold text-text">Recent Team Activity</h2>
          {data && data.recentActivity.length > 0 ? (
            <ActivityFeed events={data.recentActivity} />
          ) : (
            <p className="py-2 text-[12.5px] text-text-3">No activity yet in this workspace.</p>
          )}
        </div>
      </div>

      {showRoles && workspaceId && (
        <RolesPermissionsModal
          workspaceId={workspaceId}
          canEdit={canManageTeam}
          roles={roles}
          roleCounts={roleCounts}
          onRolesChanged={reload}
          onClose={() => setShowRoles(false)}
        />
      )}

      {showInvite && workspaceId && (
        <InviteDialog
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          roles={roles}
          currentUserRole={myRole ?? 'Viewer'}
          onClose={() => setShowInvite(false)}
          onInvited={async () => {
            await reload();
          }}
        />
      )}

      {resetTarget && workspaceId && (
        <ResetPasswordDialog
          member={resetTarget}
          workspaceId={workspaceId}
          onClose={() => setResetTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Member row with inline role edit + overflow menu ────────

function MemberCard({
  member,
  roles,
  currentUserId,
  currentUserRole,
  canManageTeam,
  isCreator,
  onChangeRole,
  onRemove,
  onResetPassword,
}: {
  member: Member;
  roles: RoleInfo[];
  currentUserId: string;
  currentUserRole: RoleKey;
  /** Whether the signed-in caller currently holds "Manage Team & Roles". */
  canManageTeam: boolean;
  /** Whether the signed-in caller created this workspace — only they may edit their own role. */
  isCreator: boolean;
  onChangeRole: (role: RoleKey) => void;
  onRemove: () => void;
  /** Present only when the caller may reset this member's password. */
  onResetPassword?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // The row lives inside a `overflow-hidden` card (needed for its rounded
  // corners), which silently clips an absolutely-positioned dropdown for any
  // row that has no room below it in the card — most obviously the last row,
  // where the menu opened but was invisible. Portaled to <body> and
  // positioned from the trigger button's own screen coordinates instead, so
  // it can never be clipped by an ancestor.
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(
    null,
  );
  const [editingRole, setEditingRole] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const toggleMenu = () => {
    if (!menuOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const right = window.innerWidth - rect.right;
      // Up to 4 items at ~34px each plus container padding — flip the menu
      // above the button when there isn't room below (e.g. the last row),
      // rather than letting it render off the bottom of the viewport.
      const estimatedHeight = 150;
      if (window.innerHeight - rect.bottom < estimatedHeight && rect.top > estimatedHeight) {
        setMenuPos({ bottom: window.innerHeight - rect.top + 4, right });
      } else {
        setMenuPos({ top: rect.bottom + 4, right });
      }
    }
    setMenuOpen(o => !o);
  };

  const isSelf = member.id === currentUserId;
  // SuperAdmin can only be touched by another SuperAdmin. Self-editing is
  // blocked unless the caller is the workspace creator or already holds
  // SuperAdmin here — a lower-privileged invited member still can't change
  // their own role.
  const isProtected = isSelf
    ? !isCreator && currentUserRole !== 'SuperAdmin'
    : member.role === 'SuperAdmin' && currentUserRole !== 'SuperAdmin';
  const canEditRole = canManageTeam && !isProtected;

  const labelName = member.name || member.username;
  const stats = member.stats;
  const roleInfo = roleInfoOf(roles, member.role);
  const colorClasses = colorClassesOf(roleInfo.color);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {member.status === 'Pending' ? (
            <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-text-3">
              <i className="ti ti-mail text-[14px]" />
            </span>
          ) : (
            <span
              className={cn(
                'inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
                avatarColour(member.id),
              )}
            >
              {initials(labelName)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-text">
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

        {/* Overflow menu -- role lives on its own row below, so it never
            competes with the name for width (a long name + a long role
            label like "Super Admin" don't both fit on one line at 4 cards
            per row). */}
        <div className="relative flex-shrink-0">
          <button
            ref={buttonRef}
            type="button"
            onClick={toggleMenu}
            className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text"
            title="More actions"
          >
            <i className="ti ti-dots-vertical text-[14px]" />
          </button>
          {menuOpen &&
            menuPos &&
            createPortal(
              <div
                ref={dropdownRef}
                style={{
                  position: 'fixed',
                  top: menuPos.top,
                  bottom: menuPos.bottom,
                  right: menuPos.right,
                }}
                className="z-50 w-[180px] rounded-lg border border-border bg-surface py-1 text-left shadow-[0_4px_24px_-4px_rgba(28,25,23,0.12)]"
              >
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
                {onResetPassword && !isSelf && (
                  <MenuItem
                    icon="ti-key"
                    label="Reset password"
                    onClick={() => {
                      setMenuOpen(false);
                      onResetPassword();
                    }}
                  />
                )}
                {canManageTeam && !isSelf && (
                  <MenuItem
                    icon="ti-trash"
                    label={member.invite ? 'Revoke invite' : 'Remove from workspace'}
                    danger
                    onClick={() => {
                      setMenuOpen(false);
                      onRemove();
                    }}
                  />
                )}
              </div>,
              document.body,
            )}
        </div>
      </div>

      {/* Role — inline editor if allowed, otherwise read-only pill. Its own
          row so it never has to compete with the name for width. */}
      <div className="mt-2 pl-[46px]">
        {editingRole ? (
          <select
            autoFocus
            value={member.role}
            onChange={e => {
              const v = e.target.value;
              setEditingRole(false);
              if (v !== member.role) onChangeRole(v);
            }}
            onBlur={() => setEditingRole(false)}
            className="rounded border border-border bg-surface px-2 py-1 text-[12px] outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
          >
            {roles
              .filter(
                r => !r.isProtected || currentUserRole === 'SuperAdmin' || (isSelf && isCreator),
              )
              .map(r => (
                <option key={r.key} value={r.key}>
                  {r.name}
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
              colorClasses.pill,
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
            {roleInfo.name}
          </button>
        )}
      </div>

      {/* Workload — Assigned/Executed real from schema-backed queries; "—"
          for a member with none of that activity (e.g. a Viewer/PM role, or
          a still-pending invite) rather than a bare 0 that reads the same as
          "just hasn't happened yet this period". */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
        <StatCell value={stats?.assigned} label="Assigned" />
        <StatCell value={stats?.executed} label="Executed" />
        <StatCell value={stats?.openDefects} label="Open Defects" danger />
      </div>
    </div>
  );
}

function StatCell({
  value,
  label,
  danger,
}: {
  value: number | undefined;
  label: string;
  danger?: boolean;
}) {
  const has = !!value;
  return (
    <div>
      <p
        className={cn(
          'text-[15px] font-semibold',
          !has ? 'text-text-3' : danger ? 'text-danger' : 'text-text',
        )}
      >
        {has ? value : '—'}
      </p>
      <p className="mt-0.5 text-[10px] text-text-3">{label}</p>
    </div>
  );
}

// ─── Invite dialog ───────────────────────────────────────────

function InviteDialog({
  workspaceId,
  workspaceName,
  roles,
  currentUserRole,
  onClose,
  onInvited,
}: {
  workspaceId: string;
  workspaceName: string;
  roles: RoleInfo[];
  currentUserRole: RoleKey;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  // Default to "Tester" when it exists, else whatever the first assignable role is.
  const [role, setRole] = useState<RoleKey>(
    () => roles.find(r => r.key === 'Tester')?.key ?? roles.find(r => !r.isProtected)?.key ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // After a successful POST we render the share-link view inside the same dialog.
  const [shared, setShared] = useState<{ email: string; role: RoleKey; acceptUrl: string } | null>(
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
        role: RoleKey;
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
              <span className="font-semibold">{roleInfoOf(roles, shared.role).name}</span>.
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
                  onChange={e => setRole(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                >
                  {roles
                    .filter(r => !r.isProtected || currentUserRole === 'SuperAdmin')
                    .map(r => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                </select>
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

// Mirrors lib/permissions.ts server-side -- keep the keys/labels/defaults in
// sync with that file. "Manage Team & Roles" is the one permission actually
// enforced today (see /api/users/[id] and /api/projects/[id]/invites, both
// now checking this same per-workspace matrix instead of a hardcoded role).
// The rest record this workspace's intended model -- editable and saved,
// but not yet backed by a per-action role check anywhere else in the API
// (any signed-in member can currently create/edit cases, cycles, and runs
// regardless of role).
const PERMISSION_KEYS = [
  'viewDashboard',
  'manageTestCases',
  'createCycles',
  'executeTests',
  'viewReports',
  'manageTeamRoles',
  'settings',
] as const;
type PermissionKey = (typeof PERMISSION_KEYS)[number];

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  viewDashboard: 'View Dashboard',
  manageTestCases: 'Manage Test Cases',
  createCycles: 'Create Cycles',
  executeTests: 'Execute Tests / Quick Logs',
  viewReports: 'View Reports',
  manageTeamRoles: 'Manage Team & Roles',
  settings: 'Settings',
};

const DEFAULT_PERMISSIONS: Record<PermissionKey, RoleKey[]> = {
  viewDashboard: ['SuperAdmin', 'QAManager', 'Tester', 'Developer', 'Viewer'],
  manageTestCases: ['SuperAdmin', 'QAManager', 'Tester'],
  createCycles: ['SuperAdmin', 'QAManager'],
  executeTests: ['SuperAdmin', 'QAManager', 'Tester'],
  viewReports: ['SuperAdmin', 'QAManager', 'Tester', 'Developer', 'Viewer'],
  manageTeamRoles: ['SuperAdmin'],
  settings: ['SuperAdmin'],
};

// A SuperAdmin unchecking their own Manage Team & Roles cell would strand
// the workspace -- nobody left who could grant it back. Mirrors
// lib/permissions.ts's isLockedCell so the UI never even offers the toggle.
// Custom roles are never locked.
function isLockedCell(key: PermissionKey, role: RoleKey): boolean {
  return key === 'manageTeamRoles' && role === 'SuperAdmin';
}

// ─── Roles & Permissions reference ───────────────────────────

function RolesPermissionsModal({
  workspaceId,
  canEdit,
  roles,
  roleCounts,
  onRolesChanged,
  onClose,
}: {
  workspaceId: string;
  /** Whether the caller currently holds "Manage Team & Roles" -- can toggle cells and add/remove roles. */
  canEdit: boolean;
  roles: RoleInfo[];
  roleCounts: Record<RoleKey, number>;
  /** Refetches the member list (and its `roles`) after a role is added or removed. */
  onRolesChanged: () => void;
  onClose: () => void;
}) {
  const [matrix, setMatrix] = useState<Record<PermissionKey, RoleKey[]>>(DEFAULT_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // `${key}:${role}` currently in flight
  const [error, setError] = useState<string | null>(null);
  const [showAddRole, setShowAddRole] = useState(false);
  const [deletingRole, setDeletingRole] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ permissions: Record<PermissionKey, RoleKey[]> }>(
        `/api/projects/${workspaceId}/permissions`,
      )
      .then(r => {
        if (!cancelled) setMatrix(r.permissions);
      })
      .catch(e => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const toggle = async (key: PermissionKey, role: RoleKey) => {
    if (!canEdit || isLockedCell(key, role)) return;
    const allowed = !matrix[key].includes(role);
    const cellId = `${key}:${role}`;
    setError(null);
    setSaving(cellId);
    // Optimistic — most toggles succeed; revert on failure below.
    const prev = matrix;
    setMatrix(m => ({
      ...m,
      [key]: allowed ? [...m[key], role] : m[key].filter(r => r !== role),
    }));
    try {
      const r = await api.patch<{ permissions: Record<PermissionKey, RoleKey[]> }>(
        `/api/projects/${workspaceId}/permissions`,
        { key, role, allowed },
      );
      setMatrix(r.permissions);
    } catch (e) {
      setMatrix(prev);
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const deleteRole = async (roleKey: string, name: string) => {
    if (
      !window.confirm(
        `Delete the "${name}" role? Anyone still assigned to it must be moved off first.`,
      )
    ) {
      return;
    }
    setError(null);
    setDeletingRole(roleKey);
    try {
      await api.del(`/api/projects/${workspaceId}/roles/${roleKey}`);
      onRolesChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingRole(null);
    }
  };

  const customRoleCount = roles.filter(r => r.isCustom).length;

  const deleteAllRoles = async () => {
    if (
      !window.confirm(
        `Delete all ${customRoleCount} custom role${customRoleCount === 1 ? '' : 's'}? Any still assigned to someone will be skipped.`,
      )
    ) {
      return;
    }
    setError(null);
    setDeletingAll(true);
    try {
      const r = await api.del<{ deleted: number; skipped: { id: string; name: string }[] }>(
        `/api/projects/${workspaceId}/roles`,
      );
      onRolesChanged();
      if (r.skipped.length > 0) {
        setError(
          `Deleted ${r.deleted}. Still in use, skipped: ${r.skipped.map(s => s.name).join(', ')}.`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[880px] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)]"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-text">Roles &amp; Permissions</h3>
            <p className="mt-0.5 text-[12px] text-text-3">
              5 built-in roles, plus any workspace-specific ones you add, govern what each teammate
              can see and do.
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

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[13px] font-semibold text-text">Permission Matrix</h4>
            <div className="flex items-center gap-3">
              {canEdit && <p className="text-[11px] text-text-3">Click a cell to toggle it</p>}
              {canEdit && customRoleCount > 0 && (
                <button
                  type="button"
                  disabled={deletingAll}
                  onClick={deleteAllRoles}
                  className="inline-flex items-center gap-1 rounded-[7px] border border-border bg-surface px-2.5 py-1 text-[11.5px] font-medium text-danger hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingAll ? (
                    <i className="ti ti-loader-2 animate-spin text-[13px]" />
                  ) : (
                    <i className="ti ti-trash text-[13px]" />
                  )}
                  Delete All
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setShowAddRole(v => !v)}
                  className="inline-flex items-center gap-1 rounded-[7px] border border-border bg-surface px-2.5 py-1 text-[11.5px] font-medium text-text hover:bg-surface-2"
                >
                  <i className="ti ti-plus text-[13px]" />
                  Add Role
                </button>
              )}
            </div>
          </div>

          {showAddRole && (
            <AddRoleForm
              workspaceId={workspaceId}
              onCreated={() => {
                setShowAddRole(false);
                onRolesChanged();
              }}
              onCancel={() => setShowAddRole(false)}
            />
          )}

          {error && (
            <div className="mb-2 rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
              {error}
            </div>
          )}

          <div
            className={cn(
              'overflow-x-auto rounded-lg border border-border',
              loading && 'opacity-50',
            )}
          >
            <table className="w-full text-[12px]">
              <thead className="bg-surface-2">
                <tr>
                  <th className="border-b border-border px-3 py-2 text-left text-[10.5px] font-medium uppercase tracking-wider text-text-3">
                    Permission
                  </th>
                  {roles.map(r => (
                    <th
                      key={r.key}
                      className="min-w-[92px] border-b border-border px-2 py-2 text-center text-[10.5px] font-medium text-text-3"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                            colorClassesOf(r.color).dot,
                          )}
                        />
                        <span className="truncate uppercase tracking-wider">{r.name}</span>
                        {canEdit && (
                          <button
                            type="button"
                            disabled={deletingRole === r.key}
                            onClick={() => deleteRole(r.key, r.name)}
                            title={`Delete "${r.name}"`}
                            className="flex-shrink-0 rounded p-0.5 text-text-3 hover:bg-danger-bg hover:text-danger"
                          >
                            {deletingRole === r.key ? (
                              <i className="ti ti-loader-2 animate-spin text-[11px]" />
                            ) : (
                              <i className="ti ti-x text-[11px]" />
                            )}
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 font-normal normal-case tracking-normal text-text-3">
                        {roleCounts[r.key] ?? 0} member{(roleCounts[r.key] ?? 0) === 1 ? '' : 's'}
                      </p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_KEYS.map(key => (
                  <tr key={key} className="border-b border-border last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-text">
                      {PERMISSION_LABELS[key]}
                    </td>
                    {roles.map(r => {
                      const allowed = matrix[key].includes(r.key);
                      const locked = isLockedCell(key, r.key);
                      const cellId = `${key}:${r.key}`;
                      const interactive = canEdit && !locked && !loading;
                      return (
                        <td key={r.key} className="px-1 py-1 text-center">
                          <button
                            type="button"
                            disabled={!interactive}
                            onClick={() => toggle(key, r.key)}
                            title={
                              locked
                                ? 'SuperAdmin must always retain Manage Team & Roles'
                                : interactive
                                  ? `Click to ${allowed ? 'revoke' : 'grant'}`
                                  : undefined
                            }
                            className={cn(
                              'inline-flex h-7 w-7 items-center justify-center rounded transition-colors',
                              interactive && 'cursor-pointer hover:bg-surface-2',
                              !interactive && 'cursor-default',
                            )}
                          >
                            {saving === cellId ? (
                              <i className="ti ti-loader-2 animate-spin text-[13px] text-text-3" />
                            ) : allowed ? (
                              <i
                                className={cn(
                                  'ti ti-check text-[14px]',
                                  locked ? 'text-success/60' : 'text-success',
                                )}
                              />
                            ) : (
                              <span className="text-text-3">—</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 rounded-lg bg-surface-2 px-3.5 py-3 text-[11.5px] leading-relaxed text-text-3">
            A workspace&apos;s creator, or anyone currently holding{' '}
            <b className="text-text-2">Super Admin</b>, always retains the ability to manage their
            own role — stepping down temporarily can never turn into a permanent lockout from
            administering a workspace they own. Only{' '}
            <b className="text-text-2">Manage Team &amp; Roles</b> changes real access today — other
            rows save your preference but aren&apos;t enforced by any other part of the app yet.
          </p>
        </div>
      </div>
    </div>
  );
}

function AddRoleForm({
  workspaceId,
  onCreated,
  onCancel,
}: {
  workspaceId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>('blue');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setErr('Name is required');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await api.post(`/api/projects/${workspaceId}/roles`, { name: trimmed, color });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="flex-1">
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Product Manager"
          maxLength={40}
          onKeyDown={e => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onCancel();
          }}
          className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
        />
        {err && <p className="mt-1 text-[11px] text-danger">{err}</p>}
      </div>
      <select
        value={color}
        onChange={e => setColor(e.target.value)}
        className="rounded border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
      >
        {PALETTE_COLORS.map(c => (
          <option key={c} value={c}>
            {c[0].toUpperCase() + c.slice(1)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onCancel}
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
        Create
      </button>
    </div>
  );
}

// ─── Small visual atoms ──────────────────────────────────────

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

// Admin-triggered password reset — generates a one-time link (no email
// sending configured) that the admin copies and shares directly, same
// pattern as the invite link above.
function ResetPasswordDialog({
  member,
  workspaceId,
  onClose,
}: {
  member: Member;
  workspaceId: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (busy) return;
    setErr(null);
    try {
      setBusy(true);
      const res = await api.post<{ resetUrl: string }>(`/api/users/${member.id}/reset-password`, {
        projectId: workspaceId,
      });
      const fullUrl =
        typeof window !== 'undefined' ? `${window.location.origin}${res.resetUrl}` : res.resetUrl;
      setResetUrl(fullUrl);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!resetUrl) return;
    try {
      await navigator.clipboard.writeText(resetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this reset link', resetUrl);
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
              Reset password for {member.name || member.username}
            </h3>
            <p className="mt-0.5 text-[11.5px] text-text-3">
              {resetUrl
                ? 'Share this link directly with them — it expires in 1 hour.'
                : "They won't be emailed — you'll get a link to send them yourself."}
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
          {err && (
            <div className="rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
              {err}
            </div>
          )}

          {resetUrl ? (
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
                Reset link
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={resetUrl}
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
            </div>
          ) : (
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13.5px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <i className="ti ti-loader-2 animate-spin text-[15px]" />}
              Generate reset link
            </button>
          )}
        </div>
      </div>
    </div>
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
