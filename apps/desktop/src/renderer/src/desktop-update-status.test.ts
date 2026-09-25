import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { DesktopUpdateSnapshot } from '../../preload/bridge';
import { canCheckDesktopUpdate, desktopUpdateStatusText } from './desktop-update-status.ts';

const STATUS_CASES: Array<{
  name: string;
  snapshot: DesktopUpdateSnapshot | null;
  text: string;
  canCheck: boolean;
}> = [
  {
    name: 'initial state',
    snapshot: null,
    text: 'Checking for updates…',
    canCheck: true,
  },
  {
    name: 'unsupported installation',
    snapshot: {
      status: 'unsupported',
      currentVersion: '1.2.3',
      availableVersion: null,
      error: null,
    },
    text: 'Updates are not available for this installation.',
    canCheck: false,
  },
  {
    name: 'downloaded update',
    snapshot: {
      status: 'downloaded',
      currentVersion: '1.2.3',
      availableVersion: '1.3.0',
      error: null,
    },
    text: 'Version 1.3.0 is ready to install.',
    canCheck: true,
  },
  {
    name: 'update error',
    snapshot: {
      status: 'error',
      currentVersion: '1.2.3',
      availableVersion: null,
      error: 'Feed unreachable',
    },
    text: 'Could not check for updates: Feed unreachable',
    canCheck: true,
  },
];

for (const testCase of STATUS_CASES) {
  test(`update settings show ${testCase.name}`, () => {
    assert.equal(desktopUpdateStatusText(testCase.snapshot), testCase.text);
    assert.equal(canCheckDesktopUpdate(testCase.snapshot), testCase.canCheck);
  });
}
