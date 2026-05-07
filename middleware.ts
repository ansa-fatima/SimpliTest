import { NextRequest, NextResponse } from 'next/server';

// Edge-runtime middleware: blocks unauthenticated traffic from hitting any
// /api route except the auth endpoints themselves.
//
// We only check that a session cookie *exists* — actual session validation
// happens inside each route via `getCurrentUser()` (which can run Prisma).
// This is fine because the cookie name is HTTP-only and same-site,
// so it can't be forged easily; even if it is, Prisma will return null
// for invalid tokens and the route will 401.

const SESSION_COOKIE = 'simplitest_session';
const PUBLIC_API_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/google',
  '/api/auth/google/callback',
  '/api/auth/config',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/api')) return NextResponse.next();
  if (PUBLIC_API_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
