import { describe, expect, test } from 'bun:test';
import { loadKey, newKey, open, seal } from './secretbox';

describe('secretbox', () => {
  test('seals and opens a value under one key', () => {
    const key = loadKey(newKey())!;
    const sealed = seal(key, 'a-token');

    expect(sealed).not.toBe('a-token');
    expect(open(key, sealed)).toBe('a-token');
  });

  test('refuses a value sealed under another key, and a malformed one', () => {
    const key = loadKey(newKey())!;
    const other = loadKey(newKey())!;

    expect(open(other, seal(key, 'secret'))).toBeNull();
    expect(open(key, 'not-a-ciphertext')).toBeNull();
  });

  test('loads only a 32-byte key', () => {
    expect(loadKey(null)).toBeNull();
    expect(loadKey('')).toBeNull();
    expect(loadKey(Buffer.alloc(16).toString('base64'))).toBeNull();
    expect(loadKey(Buffer.alloc(32).toString('base64'))?.length).toBe(32);
  });
});
