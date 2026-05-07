import { ok } from '@/lib/api';
import { isGoogleConfigured } from '@/lib/google';

// GET /api/auth/config — tells the front-end which providers are available.
export async function GET() {
  return ok({
    google: isGoogleConfigured(),
  });
}
