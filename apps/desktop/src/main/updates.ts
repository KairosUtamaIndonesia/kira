import type { DesktopUpdateSnapshot } from '../preload/bridge.ts';

export type { DesktopUpdateSnapshot } from '../preload/bridge.ts';

interface DesktopUpdateCheckResult {
  isUpdateAvailable: boolean;
  version: string;
}

export interface DesktopUpdateRuntime {
  checkForUpdates(): Promise<DesktopUpdateCheckResult | null>;
  quitAndInstall(): void;
  onUpdateAvailable(callback: (version: string) => void): void;
  onUpdateDownloaded(callback: (version: string) => void): void;
  onUpdateNotAvailable(callback: () => void): void;
  onError(callback: (message: string) => void): void;
}

export interface DesktopUpdates {
  snapshot(): DesktopUpdateSnapshot;
  subscribe(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void;
  start(): Promise<DesktopUpdateSnapshot>;
  check(): Promise<DesktopUpdateSnapshot>;
  install(): Promise<{ installed: boolean; message: string }>;
}

export interface DesktopUpdatesInput {
  runtime: DesktopUpdateRuntime;
  isPackaged: boolean;
  platform: string;
  isAppImage: boolean;
  currentVersion: string;
}

export const UPDATE_FEED_URL = 'https://kairosutamindonesia.github.io/kira-updates/';

export function createDesktopUpdates(input: DesktopUpdatesInput): DesktopUpdates {
  const supported =
    input.isPackaged &&
    (input.platform === 'darwin' ||
      input.platform === 'win32' ||
      (input.platform === 'linux' && input.isAppImage));
  let held: DesktopUpdateSnapshot = {
    status: supported ? 'idle' : 'unsupported',
    currentVersion: input.currentVersion,
    availableVersion: null,
    error: null,
  };
  const listeners = new Set<(snapshot: DesktopUpdateSnapshot) => void>();

  function change(next: DesktopUpdateSnapshot): void {
    held = next;
    for (const listener of listeners) listener(held);
  }

  input.runtime.onUpdateAvailable((version) => {
    change({ ...held, status: 'downloading', availableVersion: version, error: null });
  });
  input.runtime.onUpdateDownloaded((version) => {
    change({ ...held, status: 'downloaded', availableVersion: version, error: null });
  });
  input.runtime.onUpdateNotAvailable(() => {
    change({ ...held, status: 'up-to-date', availableVersion: null, error: null });
  });
  input.runtime.onError((message) => {
    change({ ...held, status: 'error', error: message });
  });

  async function check(): Promise<DesktopUpdateSnapshot> {
    if (!supported) {
      return held;
    }
    change({ ...held, status: 'checking', error: null });
    try {
      const result = await input.runtime.checkForUpdates();
      if (result === null) {
        change({ ...held, status: 'up-to-date', availableVersion: null });
      } else if (result.isUpdateAvailable) {
        // The available event usually arrives first; this also covers runtimes
        // that return a result without emitting it.
        if (held.availableVersion !== result.version) {
          change({ ...held, status: 'downloading', availableVersion: result.version });
        }
      } else if (held.status !== 'downloaded') {
        change({ ...held, status: 'up-to-date', availableVersion: null });
      }
    } catch (error) {
      change({
        ...held,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return held;
  }

  return {
    snapshot: () => held,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => (supported ? check() : Promise.resolve(held)),
    check,
    async install() {
      if (held.status !== 'downloaded' || held.availableVersion === null) {
        return { installed: false, message: 'No downloaded update is ready to install.' };
      }
      const version = held.availableVersion;
      change({ ...held, status: 'installing' });
      try {
        input.runtime.quitAndInstall();
      } catch (error) {
        change({
          ...held,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      return { installed: true, message: `Restarting to install ${version}.` };
    },
  };
}
