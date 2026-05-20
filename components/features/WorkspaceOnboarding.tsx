'use client';

import { useState } from 'react';
import { api } from '@/lib/client';
import { Logo } from '@/components/ui/Logo';
import { cn } from '@/lib/utils';

interface WorkspaceOnboardingProps {
  userName: string;
  /** Called after a workspace is successfully created so the parent can re-fetch projects. */
  onCreated: () => void;
}

/**
 * Full-screen onboarding shown when a freshly-signed-in user has zero workspace memberships.
 * Lets them either create a new workspace (becomes its SuperAdmin) or paste an invite link.
 */
export function WorkspaceOnboarding({ userName, onCreated }: WorkspaceOnboardingProps) {
  const [mode, setMode] = useState<'create' | 'invite'>('create');
  const [name, setName] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const createWorkspace = async () => {
    if (busy) return;
    setErr(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setErr('Workspace name is required');
      return;
    }
    try {
      setBusy(true);
      await api.post('/api/projects', { name: trimmed });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openInvite = () => {
    setErr(null);
    const url = inviteUrl.trim();
    if (!url) {
      setErr('Paste your invite link');
      return;
    }
    // Accept full URL or just a token; normalise to a path the router can handle.
    let path = url;
    try {
      const u = new URL(url);
      path = u.pathname;
    } catch {
      if (!url.startsWith('/invite/')) path = `/invite/${url}`;
    }
    window.location.href = path;
  };

  const firstName = (userName || 'there').split(' ')[0];

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-[480px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo size={36} />
          <span className="text-[20px] font-semibold tracking-tight text-text">Simplitest</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-[20px] font-semibold tracking-tight text-text">
            Welcome, {firstName}.
          </h1>
          <p className="mt-1 text-[13px] text-text-2">
            You aren&apos;t in any workspace yet — create one for your team, or join one you&apos;ve
            been invited to.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-1.5 rounded-md bg-surface-2 p-1">
            <Toggle active={mode === 'create'} onClick={() => setMode('create')}>
              Create workspace
            </Toggle>
            <Toggle active={mode === 'invite'} onClick={() => setMode('invite')}>
              Have an invite?
            </Toggle>
          </div>

          {mode === 'create' && (
            <div className="mt-5">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
                Team / school / company name
              </label>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') createWorkspace();
                }}
                placeholder="Riverside School"
                className="w-full rounded border border-border bg-surface px-3 py-2 text-[14px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
              />
              <p className="mt-1.5 text-[11px] text-text-3">
                You&apos;ll be the workspace SuperAdmin. Invite teammates anytime from the Members
                tab.
              </p>

              {err && (
                <div className="mt-3 rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
                  {err}
                </div>
              )}

              <button
                type="button"
                onClick={createWorkspace}
                disabled={busy}
                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13.5px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <i className="ti ti-loader-2 animate-spin text-[15px]" />}
                <i className="ti ti-rocket text-[15px]" />
                Create workspace
              </button>
            </div>
          )}

          {mode === 'invite' && (
            <div className="mt-5">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-3">
                Paste your invite link
              </label>
              <input
                value={inviteUrl}
                onChange={e => setInviteUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') openInvite();
                }}
                placeholder="https://simplitest.app/invite/xxxxx"
                className="w-full rounded border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
              />
              <p className="mt-1.5 text-[11px] text-text-3">
                We&apos;ll open the accept page — you&apos;re already signed in, so you can join in
                one click.
              </p>

              {err && (
                <div className="mt-3 rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
                  {err}
                </div>
              )}

              <button
                type="button"
                onClick={openInvite}
                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13.5px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover"
              >
                <i className="ti ti-arrow-right text-[15px]" />
                Open invite
              </button>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-text-3">
          Each workspace has its own portals, test cases, and members. You can belong to multiple.
        </p>
      </div>
    </div>
  );
}

function Toggle({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
        active
          ? 'bg-surface text-text shadow-[0_1px_2px_rgba(0,0,0,0.05),0_0_0_1px_rgba(0,0,0,0.05)]'
          : 'text-text-3 hover:text-text',
      )}
    >
      {children}
    </button>
  );
}
