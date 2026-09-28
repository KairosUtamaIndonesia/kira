/**
 * Reading one file for the workbench.
 *
 * Read-only, and bounded on purpose: this is a look at a file, not a way to load
 * one. Both refusals are here for the same reason — a pane that drew four
 * megabytes of minified text, or a binary as replacement characters, would read
 * as the file's contents rather than as a refusal to show them.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** How large a file this will read: larger than anything worth reading here. */
const SIZE_CAP = 1024 * 1024;
const ASSET_SIZE_CAP = 16 * 1024 * 1024;
const ASSET_TYPES: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  aac: 'audio/aac',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  ogv: 'video/ogg',
  otf: 'font/otf',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export interface WorkspaceAsset {
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * The text of one file, by a path from the workspace root.
 *
 * The whole file is read at once because it cannot be larger than the cap, which
 * makes the NUL check below the same check as looking at the first bytes of a
 * larger file: a file that is not text has a NUL in it, and there is nowhere
 * else for one to hide.
 */
export async function readWorkspaceFile(root: string, path: string): Promise<string> {
  const file = join(root, path);
  const info = await stat(file);

  if (info.size > SIZE_CAP) {
    throw new Error(
      `This file is larger than the ${SIZE_CAP / (1024 * 1024)} MB the workbench reads.`,
    );
  }

  const bytes = await readFile(file);

  if (bytes.includes(0)) {
    throw new Error('This file is not text.');
  }

  return bytes.toString('utf8');
}

/**
 * Save a bounded text file only while it still matches what the editor opened.
 * A changed-on-disk refusal keeps a stale preview from silently erasing another
 * writer's work.
 */
export async function writeWorkspaceFile(
  root: string,
  path: string,
  expected: string,
  content: string,
): Promise<void> {
  if (Buffer.byteLength(content, 'utf8') > SIZE_CAP) {
    throw new Error(
      `This file is larger than the ${SIZE_CAP / (1024 * 1024)} MB the workbench reads.`,
    );
  }
  if (content.includes('\0')) throw new Error('This file is not text.');

  const current = await readWorkspaceFile(root, path);
  if (current !== expected) {
    throw new Error('This file changed on disk since it was opened. Reopen it before saving.');
  }

  await writeFile(join(root, path), content, 'utf8');
}

/** Create a new empty file or folder without replacing anything already there. */
export async function createWorkspaceItem(
  root: string,
  path: string,
  kind: 'file' | 'folder',
): Promise<void> {
  if (kind === 'folder') await mkdir(join(root, path));
  else await writeFile(join(root, path), '', { flag: 'wx' });
}

/** Copy a user-picked file into the workspace without overwriting an existing path. */
export async function uploadWorkspaceFile(
  root: string,
  path: string,
  content: Uint8Array,
): Promise<void> {
  await writeFile(join(root, path), content, { flag: 'wx' });
}

/** Read a bounded, allowlisted binary asset for native browser preview controls. */
export async function readWorkspaceAsset(root: string, path: string): Promise<WorkspaceAsset> {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const mimeType = ASSET_TYPES[extension];
  if (!mimeType) throw new Error('This file type has no preview.');

  const file = join(root, path);
  const info = await stat(file);
  if (info.size > ASSET_SIZE_CAP) {
    throw new Error(`This preview is larger than the ${ASSET_SIZE_CAP / (1024 * 1024)} MB limit.`);
  }

  const bytes = await readFile(file);
  if (bytes.length > ASSET_SIZE_CAP) {
    throw new Error(`This preview is larger than the ${ASSET_SIZE_CAP / (1024 * 1024)} MB limit.`);
  }

  return {
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    mimeType,
    sizeBytes: bytes.length,
  };
}
