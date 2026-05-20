import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSession, setSessionCookie } from '@/lib/auth';
import { exchangeCodeForProfile, MS_OAUTH_STATE_COOKIE } from '@/lib/microsoft';

// GET /api/auth/microsoft/callback?code=...&state=...
// Mirror of Google callback. Auto-creates / links user, sets session cookie.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(errorParam)}`, req.url),
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL('/?auth_error=missing_params', req.url));
  }

  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookieMap = Object.fromEntries(
    cookieHeader
      .split(';')
      .map(c => c.trim().split('='))
      .filter(p => p.length === 2),
  );
  if (cookieMap[MS_OAUTH_STATE_COOKIE] !== state) {
    return NextResponse.redirect(new URL('/?auth_error=state_mismatch', req.url));
  }

  let profile;
  try {
    profile = await exchangeCodeForProfile(code);
  } catch (e) {
    console.error('[microsoft-oauth]', e);
    return NextResponse.redirect(new URL('/?auth_error=exchange_failed', req.url));
  }

  const email = profile.email.toLowerCase();
  let user = await prisma.user.findFirst({
    where: { OR: [{ microsoftId: profile.id }, { email }] },
  });

  if (!user) {
    const base =
      email
        .split('@')[0]
        .replace(/[^a-z0-9_.-]/g, '')
        .slice(0, 24) || 'user';
    let username = base;
    let suffix = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const exists = await prisma.user.findUnique({ where: { username } });
      if (!exists) break;
      suffix++;
      username = `${base}${suffix}`;
    }

    const userCount = await prisma.user.count();
    const role = userCount === 0 ? 'SuperAdmin' : 'Tester';

    user = await prisma.user.create({
      data: {
        username,
        email,
        microsoftId: profile.id,
        name: profile.name ?? '',
        role,
      },
    });
  } else if (!user.microsoftId) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        microsoftId: profile.id,
        name: user.name || profile.name || '',
      },
    });
  }

  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.redirect(new URL('/', req.url));
  res.cookies.set({ name: MS_OAUTH_STATE_COOKIE, value: '', maxAge: 0, path: '/' });
  return setSessionCookie(res, token, expiresAt);
}
