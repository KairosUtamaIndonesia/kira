import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createDesktopUpdates, type DesktopUpdateRuntime } from './updates.ts';
import type { DesktopUpdateSnapshot } from '../preload/bridge.ts';

class FakeUpdater implements DesktopUpdateRuntime {
  callbacks: {
    available?: (version: string) => void;
    downloaded?: (version: string) => void;
    notAvailable?: () => void;
    error?: (message: string) => void;
  } = {};
  checks = 0;
  installs = 0;
  async checkForUpdates(): Promise<{ isUpdateAvailable: boolean; version: string }> {
    this.checks += 1;
    return { isUpdateAvailable: true, version: '1.3.0' };
  }
  quitAndInstall(): void {
    this.installs += 1;
  }
  onUpdateAvailable(callback: (version: string) => void): void {
    this.callbacks.available = callback;
  }
  onUpdateDownloaded(callback: (version: string) => void): void {
    this.callbacks.downloaded = callback;
  }
  onUpdateNotAvailable(callback: () => void): void {
    this.callbacks.notAvailable = callback;
  }
  onError(callback: (message: string) => void): void {
    this.callbacks.error = callback;
  }
}

const initialSnapshot: DesktopUpdateSnapshot = {
  status: 'idle',
  currentVersion: '1.2.3',
  availableVersion: null,
  error: null,
};

test('a supported packaged app checks for updates and installs only after download', async () => {
  const runtime = new FakeUpdater();
  const updates = createDesktopUpdates({
    runtime,
    isPackaged: true,
    platform: 'darwin',
    isAppImage: false,
    currentVersion: '1.2.3',
  });
  const changes: DesktopUpdateSnapshot[] = [];
  updates.subscribe((snapshot) => changes.push(snapshot));

  assert.deepEqual(updates.snapshot(), initialSnapshot);
  await updates.start();
  assert.equal(runtime.checks, 1);
  assert.equal(updates.snapshot().status, 'downloading');

  runtime.callbacks.available?.('1.3.0');
  assert.equal(updates.snapshot().status, 'downloading');
  assert.equal(updates.snapshot().availableVersion, '1.3.0');

  runtime.callbacks.downloaded?.('1.3.0');
  assert.equal(updates.snapshot().status, 'downloaded');
  assert.deepEqual(await updates.install(), {
    installed: true,
    message: 'Restarting to install 1.3.0.',
  });
  assert.equal(runtime.installs, 1);
  assert.equal(updates.snapshot().status, 'installing');
  assert.ok(changes.length >= 4);
});

test('a packaged AppImage is eligible for updates', async () => {
  const runtime = new FakeUpdater();
  const updates = createDesktopUpdates({
    runtime,
    isPackaged: true,
    platform: 'linux',
    isAppImage: true,
    currentVersion: '1.2.3',
  });

  await updates.start();
  assert.equal(runtime.checks, 1);
  assert.equal(updates.snapshot().status, 'downloading');
});

for (const input of [
  { name: 'development builds', isPackaged: false, platform: 'darwin', isAppImage: false },
  { name: 'Linux packages', isPackaged: true, platform: 'linux', isAppImage: false },
]) {
  test(`${input.name} do not start the updater`, async () => {
    const runtime = new FakeUpdater();
    const updates = createDesktopUpdates({
      runtime,
      ...input,
      currentVersion: '1.2.3',
    });

    assert.equal((await updates.start()).status, 'unsupported');
    assert.equal(runtime.checks, 0);
  });
}
