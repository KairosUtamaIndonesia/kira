import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecutionCommandResult } from '../../preload/bridge.ts';

const exec = promisify(execFile);
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Run a user-entered finite command in a checkout chosen by the main process. */
export async function runExecutionCommand(
  checkout: string,
  command: string,
): Promise<ExecutionCommandResult> {
  try {
    const { stdout, stderr } = await exec(command, {
      cwd: checkout,
      shell: true,
      timeout: 5 * 60 * 1000,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: 'utf8',
    });
    return { command, output: [stdout, stderr].filter(Boolean).join('\n'), exitCode: 0 };
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    if (typeof failure.code === 'number' || failure.code === undefined) {
      return {
        command,
        output: [failure.stdout, failure.stderr].filter(Boolean).join('\n') || failure.message,
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
      };
    }
    throw error;
  }
}
