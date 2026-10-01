/**
 * Secrets at rest, for the things Kira must keep to reach a host.
 *
 * A token connection's access token and webhook secret are held encrypted, never
 * in the clear, because the database is a copy of the company's credentials and
 * a client secret in a column is a client secret in every backup. AES-256-GCM
 * with a random nonce per value, framed as `nonce || ciphertext || tag` and
 * base64 so it is one text column. The key lives in the environment; a server
 * without one cannot store a connection, which is a refusal rather than a
 * plaintext fallback (docs/adr/0026).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** A key from its base64 environment value, or null when absent or the wrong size. */
export function loadKey(encoded: string | null): Buffer | null {
  if (encoded === null || encoded.trim() === '') return null;

  const key = Buffer.from(encoded, 'base64');
  return key.length === KEY_BYTES ? key : null;
}

/** A fresh key, base64, for a deployment to put in its environment. */
export function newKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

/** Seal `plaintext` under `key`, as one base64 string. */
export function seal(key: Buffer, plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
}

/** Open a sealed value, or null when it was not sealed with this key or is malformed. */
export function open(key: Buffer, sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64');
    if (raw.length < NONCE_BYTES + TAG_BYTES) return null;

    const nonce = raw.subarray(0, NONCE_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const ciphertext = raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
