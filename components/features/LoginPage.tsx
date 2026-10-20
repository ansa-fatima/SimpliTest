'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { SessionUser } from '@/hooks/useStore';
import { BrandMark, SIco } from '@/components/layout/sts-icons';
import './sts-v3.css';

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

// Hero tiles describe what the workspace does (the sign-in screen has no
// session, so it can't show live numbers the way the mockup's sample data does).
const TILES = [
  { label: 'Organize', value: 'Portals', meta: 'modules, suites & cases' },
  { label: 'Execute', value: 'Test runs', meta: 'cycles and quick logs' },
  { label: 'Analyze', value: 'Stability', meta: 'pass rate & trends' },
  { label: 'Integrate', value: 'Jira sync', meta: 'tickets & sub-tasks' },
];

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

  const ssoUnavailable = () =>
    setError('Single sign-on is not enabled for this workspace — use your email and password.');

  return (
    <div className="stv3 login">
      <div className="login-left">
        <div className="ll-brand">
          <BrandMark />
          <div className="ll-brand-name">
            Simpli<em>Ed</em> · STS
          </div>
        </div>

        <div className="login-hero">
          <div className="login-eyebrow">QA Workspace · v2.0</div>
          <h2>
            Build, run, and trace
            <br />
            every test in <em>one place</em>.
          </h2>
          <p>
            Hierarchical sections, test cycles, dynamic role permissions, a native execution runner
            and Jira sync — designed for teams that ship.
          </p>

          <div className="login-tiles">
            {TILES.map(t => (
              <div key={t.label} className="login-tile">
                <div className="lt-label">{t.label}</div>
                <div className="lt-value">{t.value}</div>
                <div className="lt-meta">{t.meta}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="login-right">
        <form
          className="login-form"
          onSubmit={e => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <h3>{isRegister ? 'Create your workspace' : 'Welcome back'}</h3>
          <div className="lf-sub">
            {isRegister
              ? 'Set up your SimpliEd QA workspace in seconds.'
              : 'Sign in to your SimpliEd QA workspace.'}
          </div>

          {isRegister && (
            <>
              <div className="field">
                <label className="label">Display name</label>
                <input
                  className="input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                />
              </div>
              <div className="field">
                <label className="label">Username</label>
                <input
                  className="input"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="yourname"
                  autoComplete="username"
                />
              </div>
            </>
          )}

          <div className="field">
            <label className="label">{isRegister ? 'Email' : 'Email or username'}</label>
            <input
              className="input"
              type={isRegister ? 'email' : 'text'}
              value={isRegister ? email : identifier}
              onChange={e =>
                isRegister ? setEmail(e.target.value) : setIdentifier(e.target.value)
              }
              placeholder={isRegister ? 'you@company.com' : 'ayesha.k@simplied.io'}
              autoComplete={isRegister ? 'email' : 'username'}
            />
          </div>

          <div className="field">
            <label className="label">
              Password
              {!isRegister && (
                <button
                  type="button"
                  disabled
                  title="Ask your workspace's Super Admin to reset it from Members"
                  className="lnk"
                  style={{ marginLeft: 'auto', fontSize: '11.5px' }}
                >
                  Forgot?
                </button>
              )}
            </label>
            <div className="pw-wrap">
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                className="pw-eye"
                tabIndex={-1}
                onClick={() => setShowPassword(s => !s)}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                <SIco name={showPassword ? 'eye-off' : 'eye'} />
              </button>
            </div>
          </div>

          {!isRegister && (
            <div className="login-row">
              <label>
                <button
                  type="button"
                  className={keepSignedIn ? 'cb on' : 'cb'}
                  aria-pressed={keepSignedIn}
                  onClick={() => setKeepSignedIn(v => !v)}
                >
                  <svg viewBox="0 0 12 12">
                    <path d="M2 6L5 9L10 3" />
                  </svg>
                </button>{' '}
                Keep me signed in
              </label>
            </div>
          )}

          {error && <div className="login-error">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={!canSubmit}
            style={isRegister ? { marginTop: 18 } : undefined}
          >
            {submitting
              ? isRegister
                ? 'Creating workspace…'
                : 'Signing in…'
              : isRegister
                ? 'Create workspace'
                : 'Sign in'}
            <SIco name="arrow-right" />
          </button>

          <div className="divider">or continue with</div>
          <div className="sso-row">
            <button type="button" className="sso-btn" onClick={ssoUnavailable}>
              <svg viewBox="0 0 24 24">
                <path
                  d="M22 12c0-5.5-4.5-10-10-10S2 6.5 2 12c0 5 3.7 9.1 8.4 9.9V14.9H8V12h2.4V9.8c0-2.4 1.4-3.7 3.6-3.7 1 0 2.1.2 2.1.2v2.3h-1.2c-1.2 0-1.5.7-1.5 1.5V12h2.6l-.4 2.9h-2.2v7c4.7-.8 8.4-4.9 8.4-9.9z"
                  fill="#1877F2"
                />
              </svg>
              Google
            </button>
            <button type="button" className="sso-btn" onClick={ssoUnavailable}>
              <svg viewBox="0 0 24 24">
                <path
                  d="M11 11H2V2h9v9zm11 0h-9V2h9v9zM11 22H2v-9h9v9zm11 0h-9v-9h9v9z"
                  fill="#0078D4"
                />
              </svg>
              Microsoft
            </button>
          </div>

          <div className="login-note">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--brand-700)"
              strokeWidth="2"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" />
            </svg>
            <div>
              SSO via SAML 2.0 is available on Enterprise plans.{' '}
              <a href="#" onClick={e => e.preventDefault()}>
                Contact admin
              </a>{' '}
              if your org requires it.
            </div>
          </div>

          <div className="login-switch">
            {isRegister ? (
              <>
                Already have an account?{' '}
                <button type="button" onClick={() => switchMode('signin')}>
                  Sign in
                </button>
              </>
            ) : (
              <>
                New workspace?{' '}
                <button type="button" onClick={() => switchMode('register')}>
                  Create one
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
