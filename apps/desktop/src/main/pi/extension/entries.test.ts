import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SessionMessageEntry } from '@earendil-works/pi-coding-agent';
import { partsIn, turnsStoredIn } from './entries.ts';

/**
 * A command the person ran themselves, as pi stores one: an entry of its own,
 * carrying the command, what it printed, and how it ended.
 */
function stored(
  command: string,
  result: { output: string; exitCode?: number; cancelled?: boolean },
): SessionMessageEntry {
  return {
    type: 'message',
    id: 'entry-1',
    parentId: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    message: {
      role: 'bashExecution',
      command,
      output: result.output,
      exitCode: result.exitCode,
      cancelled: result.cancelled ?? false,
      truncated: false,
      timestamp: 1,
    },
  };
}

test('a command the person ran reads back as a turn with what it printed', () => {
  const entry = stored('git commit -m "fix"', {
    output: '[main a1b2c3d] fix the thing',
    exitCode: 0,
  });

  assert.deepEqual(
    turnsStoredIn([entry]).map((each) => each.turn),
    [{ speaker: 'tool', text: '$ git commit -m "fix"\n[main a1b2c3d] fix the thing' }],
  );
  assert.deepEqual(partsIn(entry), [
    { kind: 'text', text: '$ git commit -m "fix"\n[main a1b2c3d] fix the thing' },
  ]);
});

test('a command that failed carries its exit code, and a cancelled one says it was stopped', () => {
  const cases = [
    {
      entry: stored('exit 3', { output: 'boom', exitCode: 3 }),
      want: '$ exit 3 (exit code 3)\nboom',
    },
    {
      entry: stored('yes', { output: 'y', cancelled: true }),
      want: '$ yes (cancelled)\ny',
    },
    {
      entry: stored('printf hi', { output: 'hi', exitCode: 0 }),
      want: '$ printf hi\nhi',
    },
  ];

  for (const each of cases) {
    assert.equal(turnsStoredIn([each.entry]).at(0)?.turn.text, each.want, each.want);
  }
});

test('a command that printed nothing is a turn with just the command', () => {
  assert.equal(
    turnsStoredIn([stored('true', { output: '', exitCode: 0 })]).at(0)?.turn.text,
    '$ true',
  );
});
