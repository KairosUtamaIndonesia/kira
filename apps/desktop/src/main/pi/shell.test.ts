import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { kiraShell } from './shell.ts';

test('saving a shell override persists it and applies it to open Kira sessions', async () => {
  const settings = SettingsManager.inMemory();
  const applied: (string | undefined)[] = [];
  const shell = kiraShell(settings, async (path) => {
    applied.push(path);
  });

  await shell.save('C:\\Tools\\Git\\bin\\bash.exe');

  assert.equal(settings.getShellPath(), 'C:\\Tools\\Git\\bin\\bash.exe');
  assert.deepEqual(applied, ['C:\\Tools\\Git\\bin\\bash.exe']);
});

test('clearing the override restores automatic shell detection in every open chat', async () => {
  const settings = SettingsManager.inMemory({ shellPath: 'C:\\Tools\\Git\\bin\\bash.exe' });
  const applied: (string | undefined)[] = [];
  const shell = kiraShell(settings, async (path) => {
    applied.push(path);
  });

  await shell.save(null);

  assert.equal(settings.getShellPath(), undefined);
  assert.deepEqual(applied, [undefined]);
});

test('reading an invalid saved shell path reports Pi’s resolution error without hiding the setting', () => {
  const settings = SettingsManager.inMemory({ shellPath: '/missing/bash' });
  const shell = kiraShell(settings, async () => {});

  assert.deepEqual(shell.read(), {
    configuredPath: '/missing/bash',
    resolvedPath: null,
    error: 'Custom shell path not found: /missing/bash',
  });
});
