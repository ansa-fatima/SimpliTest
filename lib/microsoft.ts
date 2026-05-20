// Minimal Microsoft (Azure AD / personal account) OAuth 2.0 helper.
// Required env vars:
//   MICROSOFT_CLIENT_ID
//   MICROSOFT_CLIENT_SECRET
//   MICROSOFT_REDIRECT_URI   e.g. http://localhost:3000/api/auth/microsoft/callback
//   MICROSOFT_TENANT         optional — defaults to "common" (work + personal)
import { randomBytes } from 'crypto';

export const MS_OAUTH_STATE_COOKIE = 'simplitest_ms_state';

export function isMicrosoftConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID &&
    process.env.MICROSOFT_CLIENT_SECRET &&
    process.env.MICROSOFT_REDIRECT_URI,
  );
}

function tenant(): string {
  return process.env.MICROSOFT_TENANT || 'common';
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
    response_type: 'code',
    response_mode: 'query',
    scope: 'openid email profile User.Read',
    state,
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${params.toString()}`;
}

export function generateState(): string {
  return randomBytes(16).toString('hex');
}

export interface MicrosoftProfile {
  id: string; // MS user id
  email: string;
  name?: string;
  picture?: string;
}

export async function exchangeCodeForProfile(code: string): Promise<MicrosoftProfile> {
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    throw new Error(`Microsoft token exchange failed (${tokenRes.status}): ${text}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error('Microsoft: no access_token in response');

  const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!profileRes.ok) throw new Error(`Microsoft profile fetch failed (${profileRes.status})`);
  const raw = (await profileRes.json()) as {
    id: string;
    mail?: string | null;
    userPrincipalName?: string;
    displayName?: string;
  };

  const email = (raw.mail ?? raw.userPrincipalName ?? '').toLowerCase();
  if (!email) throw new Error('Microsoft: no email in profile');

  return {
    id: raw.id,
    email,
    name: raw.displayName ?? '',
  };
}
