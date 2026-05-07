import { NextResponse } from 'next/server';
import { buildAuthorizeUrl, generateState, isGoogleConfigured, GOOGLE_OAUTH_STATE_COOKIE } from '@/lib/google';

// GET /api/auth/google
// Step 1: redirect the browser to Google's consent page.
export async function GET() {
  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env.' },
      { status: 503 },
    );
  }

  const state = generateState();
  const url = buildAuthorizeUrl(state);
  const res = NextResponse.redirect(url);
  res.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });
  return res;
}
