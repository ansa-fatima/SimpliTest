import { ok, serverError } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';

// GET /api/auth/me — returns the current user, or { user: null } if not signed in.
export async function GET() {
  try {
    const user = await getCurrentUser();
    return ok({ user });
  } catch (e) { return serverError(e); }
}
