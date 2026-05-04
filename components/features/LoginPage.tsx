'use client';

import { useState } from 'react';

interface LoginPageProps {
  onLogin: () => void;
}

type Mode = 'signin' | 'register';

export function LoginPage({ onLogin }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>('signin');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const isRegister = mode === 'register';
  const canSubmit = isRegister
    ? username.trim() && email.trim() && password.trim()
    : identifier.trim() && password.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;
    onLogin();
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-sky-50 px-4">
      <div className="w-full max-w-[380px] bg-white rounded-2xl shadow-xl border border-slate-200 p-8 flex flex-col gap-5">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
            ST
          </div>
          <span className="text-base font-bold text-slate-900">SimpliTest</span>
        </div>

        {/* Heading */}
        <div className="text-center">
          <h1 className="text-lg font-bold text-slate-900">
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {isRegister
              ? 'Sign up to start managing your test cases'
              : 'Sign in with email or username'}
          </p>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-3">
          {isRegister ? (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-500">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="yourname"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-500">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500">Email or username</label>
              <input
                type="text"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="you@company.com or yourname"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors cursor-pointer"
          >
            {isRegister ? 'Create account' : 'Sign in'}
          </button>
        </div>

        {/* Toggle */}
        <div className="text-center text-xs text-slate-500">
          {isRegister ? (
            <>
              Already have an account?{' '}
              <button
                onClick={() => setMode('signin')}
                className="text-blue-600 font-semibold hover:underline"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              No account yet?{' '}
              <button
                onClick={() => setMode('register')}
                className="text-blue-600 font-semibold hover:underline"
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
