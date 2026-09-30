import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { BreakdownResult } from '../preload/bridge.ts';
import { trackerFor, type TrackerWire } from './tracker.ts';

const result = {} as BreakdownResult;

test('breakdown actions preserve the tracker key seam and server refusal words', async () => {
  const calls: string[] = [];
  const wire = {
    publishBreakdown: async (key: string, spec: string) => {
      calls.push(`publish ${key} ${spec}`);
      return { kind: 'ok', body: result } as const;
    },
    markBreakdownReady: async () =>
      ({
        kind: 'refused',
        message: 'Say how we’ll know this ticket is done before an agent starts on it.',
      }) as const,
  } as unknown as TrackerWire;
  const tracker = trackerFor({
    token: async () => 'device-key',
    projectOf: () => 'project-1',
    joinLocally: () => undefined,
    wire,
  });

  assert.equal(await tracker.publishBreakdown('spec-1', []), result);
  await assert.rejects(
    tracker.markBreakdownReady('spec-1'),
    /Say how we’ll know this ticket is done before an agent starts on it\./,
  );
  assert.deepEqual(calls, ['publish device-key spec-1']);
});
