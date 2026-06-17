'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { SessionUser } from '@/hooks/useStore';
import { avatarColour, cn, initials } from '@/lib/utils';

interface ProfileProps {
  currentUser: SessionUser | null;
  /** Called after a profile change so the parent can re-fetch the session user (sidebar etc). */
  onUpdated: () => void;
}

interface MeDetails {
  id: string;
  email: string;
  username: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  status: 'Active' | 'Pending';
  createdAt: string;
  lastActiveAt: string | null;
}

interface WorkspaceRow {
  id: string;
  name: string;
  myRole: string | null;
  _count?: { portals: number; cycles: number; memberships: number };
}

export function Profile({ currentUser, onUpdated }: ProfileProps) {
  const userId = currentUser?.id;

  const [details, setDetails] = useState<MeDetails | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [me, projects] = await Promise.all([
        api.get<MeDetails>(`/api/users/${userId}`),
        api.get<WorkspaceRow[]>('/api/projects'),
      ]);
      setDetails(me);
      setWorkspaces(projects);
    } catch (e) {
      console.error('[profile reload]', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!currentUser) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg text-sm text-text-3">
        Sign in to view your profile.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6">
          <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em] text-text">
            Your profile
          </h1>
          <p className="text-[13px] text-text-2">
            Update how you appear to teammates, change your password, and see the workspaces you
            belong to.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
          {/* Avatar + identity card */}
          <ProfileCard user={details ?? sessionToDetails(currentUser)} />

          <div className="flex flex-col gap-5">
            {loading && !details ? (
              <div className="rounded-lg border border-border bg-surface p-8 text-center text-text-3">
                Loading…
              </div>
            ) : (
              details && (
                <>
                  <ProfileForm
                    initial={details}
                    onSaved={async () => {
                      await reload();
                      onUpdated();
                    }}
                  />
                  <PasswordCard userId={details.id} hasPassword={details.status === 'Active'} />
                </>
              )
            )}

            <WorkspacesCard workspaces={workspaces} myUserId={currentUser.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Identity card (avatar + name + role + email) ───────────

function ProfileCard({ user }: { user: MeDetails }) {
  const label = user.name || user.username;
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center">
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatarUrl} alt={label} className="h-20 w-20 rounded-full object-cover" />
      ) : (
        <span
          className={cn(
            'inline-flex h-20 w-20 items-center justify-center rounded-full text-[28px] font-semibold',
            avatarColour(user.id),
          )}
        >
          {initials(label)}
        </span>
      )}
      <div>
        <p className="text-[15px] font-semibold text-text">{label}</p>
        <p className="text-[12px] text-text-3">{user.email}</p>
        <span className="mt-2 inline-flex items-center rounded-full bg-primary-light px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-primary-text ring-1 ring-primary/20">
          {prettyRole(user.role)}
        </span>
      </div>
      <div className="mt-2 w-full border-t border-border pt-3 text-left text-[11.5px] text-text-3">
        <Row label="Username" value={user.username} mono />
        <Row label="Joined" value={new Date(user.createdAt).toLocaleDateString()} />
        {user.lastActiveAt && <Row label="Last active" value={timeAgo(user.lastActiveAt)} />}
        <Row label="Status" value={user.status} />
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-[10.5px] uppercase tracking-wider text-text-3">{label}</span>
      <span className={cn('truncate text-text-2', mono && 'font-mono text-[11.5px]')}>{value}</span>
    </div>
  );
}

// ─── Edit-profile form (name / email / avatar URL) ──────────

function ProfileForm({ initial, onSaved }: { initial: MeDetails; onSaved: () => void }) {
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dirty =
    name !== initial.name ||
    email !== initial.email ||
    (avatarUrl || '') !== (initial.avatarUrl || '');

  // Pick a file, resize/compress it client-side, then load it into the avatar field.
  // The server caps the final string at ~600 KB; we aim for ~50 KB to keep DB rows small.
  const onFileChosen = async (file: File) => {
    setUploadError(null);
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
      setUploadError('Please pick a JPG, PNG, WebP, or GIF image');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Image is larger than 10 MB');
      return;
    }
    try {
      setUploadBusy(true);
      const dataUrl = await resizeImage(file, 256, 0.85);
      setAvatarUrl(dataUrl);
    } catch (e) {
      setUploadError((e as Error).message || 'Failed to read image');
    } finally {
      setUploadBusy(false);
    }
  };

  const removeAvatar = () => {
    setAvatarUrl('');
    setUploadError(null);
  };

  const save = async () => {
    if (!dirty || busy) return;
    setError(null);
    try {
      setBusy(true);
      await api.patch(`/api/users/${initial.id}`, {
        name: name.trim(),
        email: email.trim(),
        avatarUrl: avatarUrl.trim() || null,
      });
      setSavedAt(Date.now());
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const showInitialsPreview = !avatarUrl;
  const previewLabel = name || initial.username;

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-[14px] font-semibold text-text">Profile</h3>
        <p className="mt-0.5 text-[11.5px] text-text-3">Visible to everyone in your workspaces.</p>
      </div>
      <div className="space-y-4 px-5 py-4">
        {/* Avatar uploader ─────────────────────────────────── */}
        <Field label="Profile picture">
          <div className="flex items-center gap-4">
            {showInitialsPreview ? (
              <span
                className={cn(
                  'flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full text-[20px] font-semibold',
                  avatarColour(initial.id),
                )}
              >
                {initials(previewLabel)}
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Avatar preview"
                className="h-16 w-16 flex-shrink-0 rounded-full object-cover"
              />
            )}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadBusy}
                  className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-2 disabled:opacity-50"
                >
                  {uploadBusy ? (
                    <i className="ti ti-loader-2 animate-spin text-[14px]" />
                  ) : (
                    <i className="ti ti-upload text-[14px]" />
                  )}
                  {avatarUrl ? 'Change' : 'Upload image'}
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={removeAvatar}
                    className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text-2 hover:bg-red-50 hover:text-red-700"
                  >
                    <i className="ti ti-trash text-[14px]" />
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-text-3">
                JPG, PNG, WebP, or GIF. We resize to 256×256 before saving — keep it square for best
                results.
              </p>
              {uploadError && <p className="text-[11px] text-danger-text">{uploadError}</p>}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) onFileChosen(f);
                e.target.value = '';
              }}
            />
          </div>
        </Field>

        <Field label="Display name">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Aisha Lin"
            className="input"
          />
        </Field>
        <Field label="Email">
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            type="email"
            className="input"
          />
          <p className="mt-1 text-[11px] text-text-3">
            Used for sign-in and invite emails. Changing it signs you in with the new email next
            time.
          </p>
        </Field>

        {error && <FormError message={error} />}
        {savedAt && !error && !dirty && <p className="text-[12px] text-emerald-600">Saved ✓</p>}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button
          type="button"
          onClick={() => {
            setName(initial.name);
            setEmail(initial.email);
            setAvatarUrl(initial.avatarUrl ?? '');
            setError(null);
            setUploadError(null);
          }}
          disabled={!dirty || busy}
          className="rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-2 disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
          <i className="ti ti-device-floppy text-[13px]" />
          Save changes
        </button>
      </div>
    </div>
  );
}

// Resize a user-picked image into a square data URL no bigger than `maxSize` per side.
// Resizing client-side keeps the payload tiny and avoids needing object storage.
async function resizeImage(file: File, maxSize: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      // Constrain the longer side to maxSize; preserve aspect ratio.
      if (width > height && width > maxSize) {
        height = Math.round(height * (maxSize / width));
        width = maxSize;
      } else if (height > maxSize) {
        width = Math.round(width * (maxSize / height));
        height = maxSize;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return reject(new Error('Canvas not supported in this browser'));
      }
      // White background for transparent PNGs so JPEG export doesn't show black.
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      // JPEG for photos, fallback to PNG for already-tiny images / transparent inputs.
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        reject(e as Error);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

// ─── Password card (current + new + confirm) ────────────────

function PasswordCard({ userId, hasPassword }: { userId: string; hasPassword: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const save = async () => {
    setError(null);
    setSuccess(false);
    if (next.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (next !== confirm) {
      setError('Passwords don’t match');
      return;
    }
    try {
      setBusy(true);
      await api.patch(`/api/users/${userId}`, {
        currentPassword: current,
        newPassword: next,
      });
      setSuccess(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-[14px] font-semibold text-text">Password</h3>
        <p className="mt-0.5 text-[11.5px] text-text-3">
          {hasPassword
            ? 'Update your sign-in password. Active sessions stay valid until they expire.'
            : 'You signed up via invite — set a password to enable email login.'}
        </p>
      </div>
      <div className="space-y-3 px-5 py-4">
        {hasPassword && (
          <Field label="Current password">
            <input
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              className="input"
            />
          </Field>
        )}
        <Field label="New password">
          <input
            type="password"
            value={next}
            onChange={e => setNext(e.target.value)}
            placeholder="At least 8 characters"
            className="input"
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="input"
          />
        </Field>

        {error && <FormError message={error} />}
        {success && <p className="text-[12px] text-emerald-600">Password updated ✓</p>}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !next || !confirm}
          className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <i className="ti ti-loader-2 animate-spin text-[13px]" />}
          <i className="ti ti-key text-[13px]" />
          {hasPassword ? 'Update password' : 'Set password'}
        </button>
      </div>
    </div>
  );
}

// ─── Workspaces list ────────────────────────────────────────

function WorkspacesCard({
  workspaces,
  myUserId,
}: {
  workspaces: WorkspaceRow[];
  myUserId: string;
}) {
  if (workspaces.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-[14px] font-semibold text-text">Workspaces</h3>
        <p className="mt-0.5 text-[11.5px] text-text-3">
          You belong to {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {workspaces.map(w => (
          <li
            key={w.id}
            className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-text">{w.name}</p>
              {w._count && (
                <p className="text-[11px] text-text-3">
                  {w._count.portals} portal{w._count.portals === 1 ? '' : 's'} · {w._count.cycles}{' '}
                  cycle{w._count.cycles === 1 ? '' : 's'}
                  {' · '}
                  {w._count.memberships} member{w._count.memberships === 1 ? '' : 's'}
                </p>
              )}
            </div>
            {w.myRole && (
              <span className="rounded-full bg-primary-light px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-primary-text ring-1 ring-primary/20">
                {prettyRole(w.myRole)}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-5 py-2 text-[11px] text-text-3">
        Need access to another workspace? Ask its admin for an invite.
      </div>
    </div>
  );
}

// ─── Tiny helpers ───────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium uppercase tracking-wider text-text-3">
        {label}
      </label>
      {children}
      <style jsx>{`
        :global(.input) {
          @apply w-full rounded-md border border-border bg-surface px-3 py-2 text-[13.5px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light;
        }
      `}</style>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <div className="rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
      {message}
    </div>
  );
}

function prettyRole(role: string): string {
  if (role === 'SuperAdmin') return 'Super Admin';
  if (role === 'QAManager') return 'QA Manager';
  return role;
}

function sessionToDetails(u: SessionUser): MeDetails {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    name: u.name,
    role: u.role,
    avatarUrl: null,
    status: 'Active',
    createdAt: new Date().toISOString(),
    lastActiveAt: null,
  };
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
