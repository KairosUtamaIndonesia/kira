/**
 * Reading one file for the workbench.
 *
 * Read-only, and bounded on purpose: this is a look at a file, not a way to load
 * one. Both refusals are here for the same reason — a pane that drew four
 * megabytes of minified text, or a binary as replacement characters, would read
 * as the file's contents rather than as a refusal to show them.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** How large a file this will read: larger than anything worth reading here. */
const SIZE_CAP = 1024 * 1024;

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
