import {
  createLocalBashOperations,
  getAgentDir,
  getShellConfig,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { ShellSettingsSnapshot, ShellTestResult } from '../../preload/bridge.ts';

const TEST_COMMAND = "printf 'Kira shell test passed\\n'";
const TEST_TIMEOUT_MS = 5_000;

export interface KiraShell {
  read(): ShellSettingsSnapshot;
  test(path: string | null): Promise<ShellTestResult>;
  save(path: string | null): Promise<void>;
}

export function kiraShellSettings(
  applyToOpenChats: (path: string | undefined) => Promise<void>,
): KiraShell {
  const settings = SettingsManager.create(process.cwd(), getAgentDir(), {
    projectTrusted: false,
  });
  return kiraShell(settings, applyToOpenChats);
}

export function kiraShell(
  settings: SettingsManager,
  applyToOpenChats: (path: string | undefined) => Promise<void>,
  cwd = process.cwd(),
): KiraShell {
  return {
    read() {
      const configuredPath = settings.getShellPath() ?? null;
      try {
        return {
          configuredPath,
          resolvedPath: getShellConfig(configuredPath ?? undefined).shell,
          error: null,
        };
      } catch (error) {
        return {
          configuredPath,
          resolvedPath: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async test(path) {
      const shellPath = path ?? undefined;
      const resolvedPath = getShellConfig(shellPath).shell;
      const operations = createLocalBashOperations({ shellPath });
      const output: Buffer[] = [];
      const result = await operations.exec(TEST_COMMAND, cwd, {
        timeout: TEST_TIMEOUT_MS,
        onData: (chunk) => output.push(chunk),
      });
      if (result.exitCode !== 0) {
        const detail = Buffer.concat(output).toString('utf8').trim();
        throw new Error(detail || `Bash exited with code ${result.exitCode ?? 'unknown'}.`);
      }
      if (!Buffer.concat(output).toString('utf8').includes('Kira shell test passed')) {
        throw new Error('Bash started but did not return the expected test output.');
      }

      return { resolvedPath };
    },

    async save(path) {
      settings.setShellPath(path ?? undefined);
      await settings.flush();
      const errors = settings.drainErrors();
      if (errors.length > 0) {
        throw errors[0]!.error;
      }
      await applyToOpenChats(path ?? undefined);
    },
  };
}
