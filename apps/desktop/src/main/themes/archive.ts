import { inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const inflate = promisify(inflateRaw);
const MAX_THEME_FILE_BYTES = 512 * 1024;
const MAX_ARCHIVE_CONTENT_BYTES = 100 * 1024 * 1024;

/** Read selected files in a VSIX without extracting untrusted paths onto disk. */
export function openThemeArchive(bytes: Buffer): (path: string) => Promise<string> {
  let end = bytes.length - 22;
  const lower = Math.max(0, end - 65_535);
  while (
    end >= lower &&
    (bytes.readUInt32LE(end) !== 0x06054b50 ||
      end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length)
  )
    end--;
  if (end < lower) throw new Error('Invalid VSIX directory.');

  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16);
  if (
    count > 5000 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count ||
    cursor + directorySize !== end
  )
    throw new Error('Unsupported VSIX directory.');

  const entries = new Map<
    string,
    { offset: number; compressed: number; size: number; method: number }
  >();
  let totalSize = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('Invalid VSIX entry.');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const next =
      cursor + 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    const offset = bytes.readUInt32LE(cursor + 42);
    if (next > end || nameLength > 1024 || (flags & 1) !== 0 || ![0, 8].includes(method)) {
      throw new Error('Unsupported VSIX entry.');
    }
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const parts = name.replace(/\/$/u, '').split('/');
    if (
      parts.some((part) => !part || part === '.' || part === '..') ||
      /[\\\0:]/u.test(name) ||
      entries.has(name)
    ) {
      throw new Error('Unsafe VSIX path.');
    }
    totalSize += size;
    if (totalSize > MAX_ARCHIVE_CONTENT_BYTES) throw new Error('VSIX contents are too large.');
    entries.set(name, { offset, compressed, size, method });
    cursor = next;
  }
  if (cursor !== end) throw new Error('Invalid VSIX directory size.');

  return async (path) => {
    const entry = entries.get(path);
    if (!entry || entry.size > MAX_THEME_FILE_BYTES)
      throw new Error('Theme file is missing or too large.');
    const { offset, compressed, size, method } = entry;
    if (
      offset + 30 > bytes.length ||
      bytes.readUInt32LE(offset) !== 0x04034b50 ||
      bytes.readUInt16LE(offset + 8) !== method
    ) {
      throw new Error('Invalid VSIX file.');
    }
    const nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    if (
      start + compressed > bytes.length ||
      bytes.toString('utf8', offset + 30, offset + 30 + nameLength) !== path
    ) {
      throw new Error('Invalid VSIX file bounds.');
    }
    const data = bytes.subarray(start, start + compressed);
    const output =
      method === 0 ? data : await inflate(data, { maxOutputLength: MAX_THEME_FILE_BYTES });
    if (output.length !== size) throw new Error('Invalid VSIX file size.');
    return output.toString('utf8');
  };
}
