import { describe, expect, test } from 'bun:test';
import { workerHandlers } from './worker.ts';

describe('the worker channel', () => {
  test('answers what this desktop is as a worker', async () => {
    const standing = { name: 'brandon-laptop', here: true, trouble: null };
    const handlers = workerHandlers({ standing: () => standing });

    expect(await handlers.standing()).toEqual({ ok: true, value: standing });
  });

  test('answers a failure as a value rather than throwing it across the boundary', async () => {
    const handlers = workerHandlers({
      standing: () => {
        throw new Error('the keeper is not there');
      },
    });

    expect(await handlers.standing()).toEqual({ ok: false, error: 'the keeper is not there' });
  });
});
