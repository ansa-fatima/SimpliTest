import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSession, setSessionCookie } from '@/lib/auth';
import { exchangeCodeForProfile, GOOGLE_OAUTH_STATE_COOKIE } from '@/lib/google';

// GET /api/auth/google/callback?code=...&state=...
// Step 2: Google redirects here with an auth code. We exchange it, find/create
// a user matching the Google profile, set our session cookie, and redirect home.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(errorParam)}`, req.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL('/?auth_error=missing_params', req.url));
  }

  // CSRF: state cookie must match the state Google echoed back
  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookieMap = Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('=')).filter(p => p.length === 2)
  );
  if (cookieMap[GOOGLE_OAUTH_STATE_COOKIE] !== state) {
    return NextResponse.redirect(new URL('/?auth_error=state_mismatch', req.url));
  }

  let profile;
  try {
    profile = await exchangeCodeForProfile(code);
  } catch (e) {
    console.error('[google-oauth]', e);
    return NextResponse.redirect(new URL('/?auth_error=exchange_failed', req.url));
  }

  const email = profile.email.toLowerCase();

  // Find or create the user, then ensure googleId is linked.
  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId: profile.sub }, { email }] },
  });
  if (!user) {
    // Generate a unique username from the email prefix
    const base = email.split('@')[0].replace(/[^a-z0-9_.-]/g, '').slice(0, 24) || 'user';
    let username = base;
    let suffix = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const exists = await prisma.user.findUnique({ where: { username } });
      if (!exists) break;
      suffix++;
      username = `${base}${suffix}`;
    }
    user = await prisma.user.create({
      data: {
        username,
        email,
        googleId: profile.sub,
        name: profile.name ?? '',
        avatarUrl: profile.picture ?? null,
      },
    });
  } else if (!user.googleId) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        googleId: profile.sub,
        name: user.name || profile.name || '',
        avatarUrl: user.avatarUrl ?? profile.picture ?? null,
      },
    });
  }

  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.redirect(new URL('/', req.url));
  // Clear the OAuth state cookie
  res.cookies.set({ name: GOOGLE_OAUTH_STATE_COOKIE, value: '', maxAge: 0, path: '/' });
  return setSessionCookie(res, token, expiresAt);
}
