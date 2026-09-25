import {
  SHELL_CHANNELS,
  type Result,
  type ShellSettingsSnapshot,
  type ShellTestResult,
} from '../../preload/bridge.ts';
import { envelope } from './result.ts';

export { SHELL_CHANNELS };

export interface ShellHandlers {
  load(): Promise<Result<ShellSettingsSnapshot>>;
  browse(): Promise<Result<string | null>>;
  test(path: unknown): Promise<Result<ShellTestResult>>;
  save(path: unknown): Promise<Result<null>>;
}

export interface ShellDeps {
  read(): ShellSettingsSnapshot;
  choose(): Promise<string | null>;
  test(path: string | null): Promise<ShellTestResult>;
  save(path: string | null): Promise<void>;
}

const INVALID_PATH = 'Choose a Bash executable path or use automatic detection.';

export function shellHandlers({ read, choose, test, save }: ShellDeps): ShellHandlers {
  function pathIn(value: unknown): string | null | undefined {
    if (value === null) return null;
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    return value.trim();
  }

  return {
    load: () => envelope(() => read()),
    browse: () => envelope(() => choose()),
    test: (value) => {
      const path = pathIn(value);
      if (path === undefined) return Promise.resolve({ ok: false, error: INVALID_PATH });
      return envelope(() => test(path));
    },
    save: (value) => {
      const path = pathIn(value);
      if (path === undefined) return Promise.resolve({ ok: false, error: INVALID_PATH });
      return envelope(async () => {
        await save(path);
        return null;
      });
    },
  };
}
