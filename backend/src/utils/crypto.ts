import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Application-layer encryption for PII at rest (AES-256-GCM) plus an HMAC
 * "blind index" so encrypted fields can still be looked up by exact value.
 * Never log or return the plaintext or the raw key material.
 */

function derive32(secret: string): Buffer {
  // Accept hex / base64 / arbitrary string; always end up with 32 bytes.
  if (/^[0-9a-f]{64}$/i.test(secret)) return Buffer.from(secret, 'hex');
  const b64 = Buffer.from(secret, 'base64');
  if (b64.length === 32) return b64;
  return crypto.createHash('sha256').update(secret).digest();
}

const KEY = derive32(env.PII_ENCRYPTION_KEY);
const BINDEX_KEY = env.PII_BLIND_INDEX_KEY;

/** plaintext -> "v1:<base64(iv|tag|ciphertext)>" */
export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, enc]).toString('base64')}`;
}

export function decryptField(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith('v1:')) return stored; // tolerate legacy plaintext
  try {
    const raw = Buffer.from(stored.slice(3), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Deterministic keyed hash for equality lookups on an encrypted column. */
export function blindIndex(plain: string): string {
  return crypto.createHmac('sha256', BINDEX_KEY).update(plain.trim()).digest('hex');
}

/** Plain SHA-256 hex digest — used to store refresh tokens / verification codes
 *  at rest without ever persisting the raw value. */
export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** One-way hash for low-sensitivity correlation values (IP, user-agent). */
export function correlationHash(value: string | undefined | null): string | null {
  if (!value) return null;
  return sha256Hex(value);
}

/** "1990123456789" -> "•••••••••3456" (last 4 shown). */
export function maskNid(nid: string | null | undefined): string | null {
  if (!nid) return null;
  const tail = nid.slice(-4);
  return `${'•'.repeat(Math.max(nid.length - 4, 0))}${tail}`;
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Cryptographically random zero-padded numeric code, e.g. randomNumericCode(6) -> "042817". */
export function randomNumericCode(digits = 6): string {
  const max = 10 ** digits;
  return crypto.randomInt(0, max).toString().padStart(digits, '0');
}
