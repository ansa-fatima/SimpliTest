'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Logo } from '@/components/ui/Logo';
import { avatarColour, cn, initials } from '@/lib/utils';

type InviteStatus = 'Pending' | 'Accepted' | 'Revoked' | 'Expired';

interface InvitePayload {
  invite: {
    id: string;
    email: string;
    role: string;
    status: InviteStatus;
    expiresAt: string;
    project: { id: string; name: string; slug: string };
    invitedBy: { id: string; name: string; username: string; email: string } | null;
  };
  viewer: { id: string; email: string; isInvitee: boolean } | null;
}

/**
 * Public invite-acceptance page. Two modes:
 *   • Signed-in with the matching email → one-click accept.
 *   • Signed-out (or mismatched email)  → sign-up form pre-filled with the invite email.
 */
export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [data, setData] = useState<InvitePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await api.get<InvitePayload>(`/api/invites/${token}`);
      setData(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ─── Render ──────────────────────────────────────────────
  if (loading) {
    return (
      <Frame>
        <p className="text-[13px] text-text-3">Loading invite…</p>
      </Frame>
    );
  }
  if (error || !data) {
    return (
      <Frame>
        <BadInviteBox
          icon="ti-alert-triangle"
          title="Invite not found"
          body={error ?? "We couldn't find that invite. The link may be incorrect or revoked."}
        />
      </Frame>
    );
  }

  const { invite, viewer } = data;
  if (invite.status === 'Accepted') {
    return (
      <Frame>
        <BadInviteBox
          icon="ti-check"
          title="Already accepted"
          body={`You're already a member of ${invite.project.name}.`}
          cta={{ label: 'Open workspace', onClick: () => router.push('/') }}
        />
      </Frame>
    );
  }
  if (invite.status === 'Revoked') {
    return (
      <Frame>
        <BadInviteBox
          icon="ti-ban"
          title="Invite revoked"
          body="The workspace owner cancelled this invite. Ask them to send a new one."
        />
      </Frame>
    );
  }
  if (invite.status === 'Expired' || new Date(invite.expiresAt) < new Date()) {
    return (
      <Frame>
        <BadInviteBox
          icon="ti-clock-off"
          title="Invite expired"
          body="Invitations expire after 7 days. Ask the workspace owner to send a fresh one."
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <Card invite={invite} viewer={viewer} token={token!} onAccepted={() => router.push('/')} />
    </Frame>
  );
}

// ─── Layout frame ───────────────────────────────────────────

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo size={36} />
          <span className="text-[20px] font-semibold tracking-tight text-text">Simplitest</span>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Main card ──────────────────────────────────────────────

function Card({
  invite,
  viewer,
  token,
  onAccepted,
}: {
  invite: InvitePayload['invite'];
  viewer: InvitePayload['viewer'];
  token: string;
  onAccepted: () => void;
}) {
  const inviterName = invite.invitedBy?.name || invite.invitedBy?.username || 'A teammate';

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
      {/* Inviter avatar */}
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'inline-flex h-12 w-12 items-center justify-center rounded-full text-[14px] font-semibold',
            avatarColour(invite.invitedBy?.id ?? invite.id),
          )}
        >
          {initials(inviterName)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text">{inviterName}</p>
          <p className="truncate text-[12px] text-text-3">
            invited you to <span className="font-medium text-text">{invite.project.name}</span>
          </p>
        </div>
      </div>

      <div className="my-5 rounded-lg border border-border bg-surface-2/40 p-3 text-[12.5px]">
        <Row label="Workspace" value={invite.project.name} />
        <Row label="Email" value={invite.email} mono />
        <Row label="Role" value={prettyRole(invite.role)} />
        <Row label="Expires" value={new Date(invite.expiresAt).toLocaleString()} />
      </div>

      {viewer ? (
        viewer.isInvitee ? (
          <SignedInAccept token={token} project={invite.project.name} onAccepted={onAccepted} />
        ) : (
          <MismatchedEmail viewerEmail={viewer.email} inviteEmail={invite.email} />
        )
      ) : (
        <SignedOutAccept token={token} inviteEmail={invite.email} onAccepted={onAccepted} />
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[11px] uppercase tracking-wider text-text-3">{label}</span>
      <span className={cn('truncate text-text', mono && 'font-mono text-[11.5px]')}>{value}</span>
    </div>
  );
}

function prettyRole(role: string): string {
  if (role === 'SuperAdmin') return 'Super Admin';
  if (role === 'QAManager') return 'QA Manager';
  return role;
}

// ─── Modes ─────────────────────────────────────────────────

function SignedInAccept({
  token,
  project,
  onAccepted,
}: {
  token: string;
  project: string;
  onAccepted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accept = async () => {
    if (busy) return;
    setErr(null);
    try {
      setBusy(true);
      await api.post(`/api/invites/${token}/accept`);
      onAccepted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {err && (
        <div className="mb-3 rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
          {err}
        </div>
      )}
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13.5px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <i className="ti ti-loader-2 animate-spin text-[15px]" />}
        <i className="ti ti-check text-[15px]" />
        Join {project}
      </button>
    </div>
  );
}

function MismatchedEmail({
  viewerEmail,
  inviteEmail,
}: {
  viewerEmail: string;
  inviteEmail: string;
}) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-700">
      You&apos;re signed in as <strong>{viewerEmail}</strong>, but this invite was sent to{' '}
      <strong>{inviteEmail}</strong>. Sign out and sign in with that email to accept.
    </div>
  );
}

function SignedOutAccept({
  token,
  inviteEmail,
  onAccepted,
}: {
  token: string;
  inviteEmail: string;
  onAccepted: () => void;
}) {
  const [username, setUsername] = useState(suggestUsername(inviteEmail));
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accept = async () => {
    if (busy) return;
    setErr(null);
    try {
      setBusy(true);
      await api.post(`/api/invites/${token}/accept`, {
        username,
        password,
        name,
      });
      onAccepted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-text-3">
        Create your account to accept. (We&apos;ll use{' '}
        <span className="font-medium text-text">{inviteEmail}</span> as your sign-in email.)
      </p>

      <Field label="Display name (optional)">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Sara K. Mehta"
          className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
        />
      </Field>
      <Field label="Username">
        <input
          value={username}
          onChange={e => setUsername(e.target.value.toLowerCase())}
          className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
          onKeyDown={e => {
            if (e.key === 'Enter') accept();
          }}
        />
      </Field>

      {err && (
        <div className="rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
          {err}
        </div>
      )}

      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13.5px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <i className="ti ti-loader-2 animate-spin text-[15px]" />}
        <i className="ti ti-user-check text-[15px]" />
        Create account & join
      </button>

      <p className="text-center text-[11px] text-text-3">
        Already have an account?{' '}
        <a href="/" className="text-primary hover:underline">
          Sign in first
        </a>{' '}
        then reopen this link.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
        {label}
      </label>
      {children}
    </div>
  );
}

function suggestUsername(email: string): string {
  return (email.split('@')[0] || '').replace(/[^a-z0-9_.-]/gi, '').toLowerCase();
}

// ─── Bad-state box ──────────────────────────────────────────

function BadInviteBox({
  icon,
  title,
  body,
  cta,
}: {
  icon: string;
  title: string;
  body: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-text-3">
        <i className={cn('ti', icon, 'text-[24px]')} />
      </span>
      <p className="mt-3 text-[15px] font-semibold text-text">{title}</p>
      <p className="mx-auto mt-1 max-w-[320px] text-[12.5px] text-text-3">{body}</p>
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-hover"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}
