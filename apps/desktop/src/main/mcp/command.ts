import { existsSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

/*
 * MIT License
 *
 * Copyright (c) 2026 Nico Bailon
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * PATH lookup adapted from pi-mcp-adapter's npx-resolver.ts. Foundry keeps this
 * small, host-independent part so a desktop launch can resolve the Node
 * package-manager binaries without relying on a terminal's shell setup.
 */
export interface CommandEnvironment {
  path: string | undefined;
  platform: NodeJS.Platform;
  execPath: string;
}

export function resolveCommand(
  command: string,
  environment: CommandEnvironment = {
    path: process.env.PATH,
    platform: process.platform,
    execPath: process.execPath,
  },
): string {
  if (command.includes('/') || command.includes('\\')) return command;

  const pathEntries = (environment.path ?? '').split(delimiter).filter(Boolean);
  const candidates = environment.platform === 'win32'
    ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
    : [command];
  const extraEntries = [dirname(environment.execPath), join(dirname(environment.execPath), '..', 'bin')];

  for (const folder of [...pathEntries, ...extraEntries]) {
    for (const candidate of candidates) {
      const full = join(folder, candidate);
      try {
        if (existsSync(full) && statSync(full).isFile()) return full;
      } catch {
        // A stale PATH entry is not a connection failure by itself.
      }
    }
  }

  return command;
}
