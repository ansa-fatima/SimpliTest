// Optional encryption-at-rest for stored secrets (the workspace AI API key).
//
// If the server has APP_ENCRYPTION_KEY set (any string of 16+ characters), new
// secrets are saved as AES-256-GCM ciphertext ("enc:v1:<base64>"). Without it
// they are stored as-is, exactly like the existing Jira token -- so nothing
// breaks for a deployment that never configures a key. Reading handles both,
// so turning encryption on later only affects values saved afterwards.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

function keyFromEnv(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) return null;
  return createHash('sha256').update(raw).digest();
}

/** True when new secrets will be encrypted on this server. */
export function encryptionEnabled(): boolean {
  return keyFromEnv() !== null;
}

export function sealSecret(plain: string): string {
  const key = keyFromEnv();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function openSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = keyFromEnv();
  if (!key)
    throw new Error(
      'A stored secret is encrypted but APP_ENCRYPTION_KEY is not set on the server.',
    );
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

/** "sk-ant-api03-…WxYz" -- enough to recognise a key without revealing it. */
export function maskSecret(plain: string): string {
  if (plain.length <= 10) return '••••••••';
  return `${plain.slice(0, 7)}…${plain.slice(-4)}`;
}
