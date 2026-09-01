'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Logo } from '@/components/ui/Logo';
import { cn } from '@/lib/utils';

interface PeekPayload {
  email: string;
  expiresAt: string;
}

/** Public password-reset page — reached via a one-time link an admin shares directly. */
export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [data, setData] = useState<PeekPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await api.get<PeekPayload>(`/api/reset-password/${token}`);
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

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo size={36} />
          <span className="text-[20px] font-semibold tracking-tight text-text">Simplitest</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          {loading ? (
            <p className="text-center text-[13px] text-text-3">Checking link…</p>
          ) : done ? (
            <SuccessBox onSignIn={() => router.push('/')} />
          ) : error || !data ? (
            <ErrorBox message={error ?? 'This reset link is invalid.'} />
          ) : (
            <ResetForm
              token={token!}
              email={data.email}
              onDone={() => setDone(true)}
              onExpired={() => setError('This reset link has expired. Ask an admin for a new one.')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ResetForm({
  token,
  email,
  onDone,
  onExpired,
}: {
  token: string;
  email: string;
  onDone: () => void;
  onExpired: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setErr(null);
    if (password.length < 8) {
      setErr('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setErr("Passwords don't match");
      return;
    }
    try {
      setBusy(true);
      await api.post(`/api/reset-password/${token}`, { newPassword: password });
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      if (/expired/i.test(msg)) onExpired();
      else setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[15px] font-semibold text-text">Set a new password</p>
        <p className="mt-0.5 text-[12px] text-text-3">
          For <span className="font-mono font-medium text-text">{email}</span>
        </p>
      </div>

      <Field label="New password">
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
        />
      </Field>
      <Field label="Confirm password">
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') submit();
          }}
          className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
        />
      </Field>

      {err && (
        <div className="rounded border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
          {err}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className={cn(
          'inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13.5px] font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {busy && <i className="ti ti-loader-2 animate-spin text-[15px]" />}
        Set new password
      </button>
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

function SuccessBox({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <i className="ti ti-check text-[24px]" />
      </span>
      <p className="mt-3 text-[15px] font-semibold text-text">Password updated</p>
      <p className="mx-auto mt-1 max-w-[280px] text-[12.5px] text-text-3">
        You can now sign in with your new password.
      </p>
      <button
        type="button"
        onClick={onSignIn}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-hover"
      >
        Sign in
      </button>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-text-3">
        <i className="ti ti-clock-off text-[24px]" />
      </span>
      <p className="mt-3 text-[15px] font-semibold text-text">Link not valid</p>
      <p className="mx-auto mt-1 max-w-[280px] text-[12.5px] text-text-3">{message}</p>
    </div>
  );
}
