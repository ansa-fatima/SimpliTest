import { NextResponse } from 'next/server';
import {
  buildAuthorizeUrl,
  generateState,
  isMicrosoftConfigured,
  MS_OAUTH_STATE_COOKIE,
} from '@/lib/microsoft';

// GET /api/auth/microsoft — kicks off the Microsoft OAuth flow.
export async function GET() {
  if (!isMicrosoftConfigured()) {
    return NextResponse.json(
      {
        error:
          'Microsoft sign-in is not configured. Set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_REDIRECT_URI in .env.',
      },
      { status: 503 },
    );
  }

  const state = generateState();
  const url = buildAuthorizeUrl(state);
  const res = NextResponse.redirect(url);
  res.cookies.set({
    name: MS_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
