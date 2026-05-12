import { cookies } from 'next/headers';
import { ok, serverError } from '@/lib/api';
import { clearSessionCookie, destroySession, SESSION_COOKIE_NAME } from '@/lib/auth';

// POST /api/auth/logout
export async function POST() {
  try {
    const token = cookies().get(SESSION_COOKIE_NAME)?.value;
    if (token) await destroySession(token);
    const res = ok({ success: true });
    return clearSessionCookie(res);
  } catch (e) {
    return serverError(e);
  }
}
