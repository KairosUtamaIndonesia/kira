import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ShellTestResult, ShellSettingsSnapshot } from '../../preload/bridge.ts';
import { shellHandlers } from './shell.ts';

function handlersFor(
  options: {
    snapshot?: ShellSettingsSnapshot;
    choose?: () => Promise<string | null>;
    testPath?: (path: string | null) => Promise<ShellTestResult>;
    save?: (path: string | null) => Promise<void>;
  } = {},
) {
  const saved: (string | null)[] = [];
  const tested: (string | null)[] = [];
  const handlers = shellHandlers({
    read: () =>
      options.snapshot ?? {
        configuredPath: null,
        resolvedPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
        error: null,
      },
    choose: options.choose ?? (async () => 'C:\\Program Files\\Git\\bin\\bash.exe'),
    test:
      options.testPath ??
      (async (path) => {
        tested.push(path);
        return { resolvedPath: path ?? 'C:\\Program Files\\Git\\bin\\bash.exe' };
      }),
    save:
      options.save ??
      (async (path) => {
        saved.push(path);
      }),
  });

  return { handlers, saved, tested };
}

test('shell settings load and browse return the current choice and selected executable', async () => {
  const { handlers } = handlersFor();

  assert.deepEqual(await handlers.load(), {
    ok: true,
    value: {
      configuredPath: null,
      resolvedPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
      error: null,
    },
  });
  assert.deepEqual(await handlers.browse(), {
    ok: true,
    value: 'C:\\Program Files\\Git\\bin\\bash.exe',
  });
});

test('testing a shell path returns the resolved executable', async () => {
  const { handlers, tested } = handlersFor();

  assert.deepEqual(await handlers.test('C:\\Tools\\Git\\bin\\bash.exe'), {
    ok: true,
    value: { resolvedPath: 'C:\\Tools\\Git\\bin\\bash.exe' },
  });
  assert.deepEqual(tested, ['C:\\Tools\\Git\\bin\\bash.exe']);
});

test('invalid paths are refused before testing or saving', async () => {
  const { handlers, saved, tested } = handlersFor();

  for (const invalid of [undefined, '', '   ', 42, {}]) {
    assert.deepEqual(await handlers.test(invalid), {
      ok: false,
      error: 'Choose a Bash executable path or use automatic detection.',
    });
    assert.deepEqual(await handlers.save(invalid), {
      ok: false,
      error: 'Choose a Bash executable path or use automatic detection.',
    });
  }

  assert.deepEqual(saved, []);
  assert.deepEqual(tested, []);
});

test('cancelled browse leaves the setting alone and automatic detection clears the override', async () => {
  const { handlers, saved } = handlersFor({ choose: async () => null });

  assert.deepEqual(await handlers.browse(), { ok: true, value: null });
  assert.deepEqual(await handlers.save(null), { ok: true, value: null });
  assert.deepEqual(saved, [null]);
});

test('a failed shell test is shown as a result and does not save a path', async () => {
  const { handlers, saved } = handlersFor({
    testPath: async () => {
      throw new Error('Bash did not start.');
    },
  });

  assert.deepEqual(await handlers.test('C:\\broken\\bash.exe'), {
    ok: false,
    error: 'Bash did not start.',
  });
  assert.deepEqual(saved, []);
});
