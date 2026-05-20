'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, ArrowRight, Sparkles } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { api } from '@/lib/client';
import type { SessionUser } from '@/hooks/useStore';

interface LoginPageProps {
  onLogin: (user: SessionUser) => void;
}

type Mode = 'signin' | 'register';

const ERR_MESSAGES: Record<string, string> = {
  state_mismatch: 'Sign-in failed: security check failed. Please try again.',
  exchange_failed: 'Sign-in failed: could not verify your account.',
  missing_params: 'Sign-in was cancelled.',
  access_denied: 'Sign-in was cancelled.',
};

export function LoginPage({ onLogin }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>('signin');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const e = params.get('auth_error');
    if (e) {
      setError(ERR_MESSAGES[e] ?? `Sign-in failed: ${e}`);
      const clean = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', clean);
    }
  }, []);

  const isRegister = mode === 'register';
  const canSubmit =
    !submitting &&
    (isRegister
      ? username.trim().length >= 3 && email.trim() && password.length >= 8
      : identifier.trim() && password);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setShowPassword(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const result = isRegister
        ? await api.post<{ user: SessionUser }>('/api/auth/register', {
            username: username.trim(),
            email: email.trim(),
            password,
            name: name.trim() || undefined,
          })
        : await api.post<{ user: SessionUser }>('/api/auth/login', {
            identifier: identifier.trim(),
            password,
          });
      onLogin(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid h-screen w-full grid-cols-1 overflow-hidden bg-bg lg:grid-cols-[1fr_440px]">
      {/* LEFT — form panel */}
      <div className="flex items-center justify-center overflow-y-auto p-6 sm:p-10">
        <div className="w-full max-w-[400px] animate-[fadeUp_0.45s_ease-out]">
          {/* Logo */}
          <div className="mb-8 flex items-center gap-2.5">
            <Logo size={32} />
            <span className="text-[18px] font-semibold tracking-tight text-text">Simplitest</span>
          </div>

          <h1 className="mb-2 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-text">
            {isRegister ? 'Create your workspace' : 'Sign in to your workspace'}
          </h1>
          <p className="mb-7 text-[14px] text-text-2">
            {isRegister
              ? 'Set up your QA workspace in seconds.'
              : 'Welcome back. Enter your details to continue.'}
          </p>

          {/* Form */}
          <div className="flex flex-col">
            {isRegister && (
              <>
                <FieldLabel>Display name</FieldLabel>
                <Input
                  value={name}
                  onChange={setName}
                  placeholder="Your full name"
                  autoComplete="name"
                />
                <FieldLabel>Username</FieldLabel>
                <Input
                  value={username}
                  onChange={setUsername}
                  placeholder="yourname"
                  autoComplete="username"
                />
              </>
            )}

            <FieldLabel>{isRegister ? 'Email' : 'Work email or username'}</FieldLabel>
            <Input
              value={isRegister ? email : identifier}
              onChange={isRegister ? setEmail : setIdentifier}
              placeholder={isRegister ? 'you@company.com' : 'aisha@school.edu'}
              type={isRegister ? 'email' : 'text'}
              autoComplete={isRegister ? 'email' : 'username'}
            />

            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[13px] font-medium text-text">Password</label>
              {!isRegister && (
                <button
                  type="button"
                  className="text-[13px] font-medium text-primary transition-colors hover:text-primary-hover"
                  disabled
                >
                  Forgot?
                </button>
              )}
            </div>
            <div className="relative mb-4">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 pr-10 text-sm text-text outline-none transition-all placeholder:text-text-3 focus:border-primary focus:ring-[3px] focus:ring-primary-light"
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                tabIndex={-1}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {!isRegister && (
              <label className="mb-5 flex cursor-pointer items-center gap-2 text-[13px] text-text-2">
                <CheckBox checked={keepSignedIn} onChange={setKeepSignedIn} />
                Keep me signed in for 30 days
              </label>
            )}

            {error && (
              <div className="mb-3 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger-text">
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-br from-[#6366F1] via-[#6D5BEA] to-[#7C3AED] px-4 py-3 text-[14px] font-semibold text-white shadow-[0_4px_14px_-2px_rgba(99,102,241,0.45)] ring-1 ring-white/15 transition-all hover:shadow-[0_8px_22px_-3px_rgba(99,102,241,0.55)] hover:brightness-[1.05] active:translate-y-px active:brightness-95 disabled:cursor-not-allowed disabled:from-text-3 disabled:via-text-3 disabled:to-text-3 disabled:shadow-none disabled:ring-0"
            >
              {/* Subtle moving shine on hover */}
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <span className="relative">
                {submitting
                  ? isRegister
                    ? 'Creating workspace…'
                    : 'Signing in…'
                  : isRegister
                    ? 'Create workspace'
                    : 'Sign in'}
              </span>
              <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>

            <div className="mt-7 text-center text-[13px] text-text-3">
              {isRegister ? (
                <>
                  Already have an account?{' '}
                  <button
                    onClick={() => switchMode('signin')}
                    className="font-medium text-primary transition-colors hover:text-primary-hover hover:underline"
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  New workspace?{' '}
                  <button
                    onClick={() => switchMode('register')}
                    className="font-medium text-primary transition-colors hover:text-primary-hover hover:underline"
                  >
                    Create one
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT — brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#4F46E5] via-[#6D5BEA] to-[#7C3AED] p-10 text-white lg:flex">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-fuchsia-400/20 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_120%,rgba(255,255,255,0.15),transparent_50%)]" />

        <div className="relative flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] opacity-90">
          <Sparkles className="h-3.5 w-3.5" />
          Simplitest · v1.0
        </div>

        <div className="relative animate-[fadeUp_0.6s_0.1s_both]">
          <div className="mb-7 flex flex-col gap-3">
            <Stat value="1,284 cases" label="across 8 products" />
            <Stat value="87% pass rate" label="last 7 days" offset />
            <Stat value="4 portals" label="Admin · Teacher · Parent · Student" />
          </div>
          <div className="text-[20px] font-semibold leading-snug tracking-[-0.01em]">
            The QA workspace your team will actually enjoy using.
          </div>
        </div>

        <div className="relative text-[12px] opacity-70">
          © {new Date().getFullYear()} Simplitest
        </div>
      </div>

      {/* Local keyframes — Tailwind utilities reference them */}
      <style jsx>{`
        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 text-[13px] font-medium text-text">{children}</label>;
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className="mb-4 w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-text outline-none transition-all placeholder:text-text-3 focus:border-primary focus:ring-[3px] focus:ring-primary-light"
    />
  );
}

function Stat({ value, label, offset }: { value: string; label: string; offset?: boolean }) {
  return (
    <div
      className={`rounded-[10px] border border-white/10 bg-white/[0.13] p-4 backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/[0.18] ${offset ? 'ml-7' : ''}`}
    >
      <div className="text-[20px] font-semibold leading-tight">{value}</div>
      <div className="mt-1 text-[12px] opacity-85">{label}</div>
    </div>
  );
}

function CheckBox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-block h-3.5 w-3.5 flex-shrink-0 rounded-[4px] border-[1.5px] transition-all ${
        checked ? 'border-primary bg-primary' : 'border-border-strong bg-surface'
      }`}
    >
      {checked && (
        <span
          className="absolute left-[3px] top-[0.5px] h-2 w-1 rotate-45 border-solid border-white"
          style={{ borderWidth: '0 2px 2px 0' }}
        />
      )}
    </button>
  );
}
