import { ok } from '@/lib/api';
import { isGoogleConfigured } from '@/lib/google';
import { isMicrosoftConfigured } from '@/lib/microsoft';

// GET /api/auth/config — tells the front-end which providers are available.
export async function GET() {
  return ok({
    google: isGoogleConfigured(),
    microsoft: isMicrosoftConfigured(),
  });
}
