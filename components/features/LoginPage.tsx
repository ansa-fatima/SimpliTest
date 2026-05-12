'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { api } from '@/lib/client';

interface SessionUser {
  id: string;
  username: string;
  email: string;
  name: string;
  role: 'SuperAdmin' | 'QAManager' | 'Tester' | 'Developer' | 'Viewer';
}

interface LoginPageProps {
  onLogin: (user: SessionUser) => void;
}

type Mode = 'signin' | 'register';

const ERR_MESSAGES: Record<string, string> = {
  state_mismatch: 'Google sign-in failed: security check failed. Please try again.',
  exchange_failed: 'Google sign-in failed: could not verify your account.',
  missing_params: 'Google sign-in was cancelled.',
  access_denied: 'Google sign-in was cancelled.',
};

export function LoginPage({ onLogin }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>('signin');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState<{ google: boolean }>({ google: false });

  // Pick up auth_error from URL (set by Google callback on failures)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const e = params.get('auth_error');
    if (e) {
      setError(ERR_MESSAGES[e] ?? `Sign-in failed: ${e}`);
      // clean the URL so a refresh doesn't show the error again
      const clean = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', clean);
    }
  }, []);

  // Fetch enabled providers (Google may or may not be configured)
  useEffect(() => {
    api
      .get<{ google: boolean }>('/api/auth/config')
      .then(setProviders)
      .catch(() => {
        /* fall back to email-only */
      });
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

  const handleGoogle = () => {
    // Full-page redirect; Google brings the user back via /api/auth/google/callback
    window.location.href = '/api/auth/google';
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-sky-50 px-4">
      <div className="flex w-full max-w-[400px] flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <Logo size={44} />
          <span className="text-base font-bold text-slate-900">SimpliTest</span>
        </div>

        {/* Heading */}
        <div className="text-center">
          <h1 className="text-lg font-bold text-slate-900">
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {isRegister
              ? 'Sign up to start managing your test cases'
              : 'Sign in with email or username'}
          </p>
        </div>

        {/* Google button */}
        {providers.google && (
          <>
            <button
              onClick={handleGoogle}
              type="button"
              className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <GoogleIcon />
              Continue with Google
            </button>
            <div className="flex items-center gap-2">
              <hr className="flex-1 border-slate-200" />
              <span className="text-[11px] uppercase tracking-wider text-slate-400">or</span>
              <hr className="flex-1 border-slate-200" />
            </div>
          </>
        )}

        {/* Form */}
        <div className="flex flex-col gap-3">
          {isRegister ? (
            <>
              <Field label="Display name" sub="(optional)">
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your full name"
                  className={inputCls}
                />
              </Field>
              <Field label="Username" hint="3–32 chars · letters, digits, _ . -">
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="yourname"
                  autoComplete="username"
                  className={inputCls}
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  className={inputCls}
                />
              </Field>
            </>
          ) : (
            <Field label="Email or username">
              <input
                type="text"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="you@company.com or yourname"
                autoComplete="username"
                className={inputCls}
              />
            </Field>
          )}

          <Field label="Password" hint={isRegister ? 'Minimum 8 characters' : undefined}>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                className={`${inputCls} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                tabIndex={-1}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full cursor-pointer rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting
              ? isRegister
                ? 'Creating account…'
                : 'Signing in…'
              : isRegister
                ? 'Create account'
                : 'Sign in'}
          </button>
        </div>

        {/* Toggle */}
        <div className="text-center text-xs text-slate-500">
          {isRegister ? (
            <>
              Already have an account?{' '}
              <button
                onClick={() => switchMode('signin')}
                className="font-semibold text-blue-600 hover:underline"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              No account yet?{' '}
              <button
                onClick={() => switchMode('register')}
                className="font-semibold text-blue-600 hover:underline"
              >
                Register
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

function Field({
  label,
  sub,
  hint,
  children,
}: {
  label: string;
  sub?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold text-slate-500">
        {label}
        {sub && <span className="font-normal text-slate-300"> {sub}</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4c-7.7 0-14.4 4.4-17.7 10.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.4 39.6 16.1 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
