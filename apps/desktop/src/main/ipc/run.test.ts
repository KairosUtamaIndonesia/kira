/**
 * The Run channel, which is one door with two things to say before it opens it.
 *
 * There is deliberately nothing here about whether a ticket *can* be run. That is the
 * server's answer — it is the party that knows whether the ticket is ready and whether
 * somebody already holds it — and its own sentence is what reaches the person. What this
 * side owes is only that a workspace and a ticket were actually named before anything is
 * spent, and that a failure comes back as a value rather than as a rejected promise in
 * whichever window happened to press Run.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { TicketRun, TicketSaid } from '../../preload/bridge.ts';
import { runHandlers, type RunDeps } from './run.ts';

const started: TicketRun = {
  id: 'run-1',
  ticketId: 'ticket-1',
  workerId: 'desk-1',
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: null,
  branch: 'fnd-1-a-ticket',
  stoppedBecause: null,
  changed: null,
  checks: null,
  made: null,
  verdict: null,
};

/** The handler over a stub that records what it was asked. */
function handlers(over: Partial<RunDeps> = {}) {
  const asked: string[] = [];

  return {
    asked,
    handlers: runHandlers({
      start: async (workspaceId, ticketId) => {
        asked.push(`${workspaceId}/${ticketId}`);
        return started;
      },
      resolve: async (workspaceId, ticketId, reason) => {
        asked.push(`resolve ${workspaceId}/${ticketId}: ${reason}`);
        return started;
      },
      transcript: async (ticketId, runId) => {
        asked.push(`${ticketId}/${runId}`);
        return [];
      },
      takeOver: async (ticketId) => {
        asked.push(`take over ${ticketId}`);
        throw new Error('That claim is still being heard from.');
      },
      release: async (ticketId) => {
        asked.push(`let go ${ticketId}`);
      },
      judge: async (ticketId, runId, verdict) => {
        asked.push(`${ticketId}/${runId} ${verdict}`);
        return started;
      },
      ...over,
    }),
  };
}

test('a workspace and a ticket, and the run the server answered with', async () => {
  const { asked, handlers: door } = handlers();

  assert.deepEqual(await door.start('workspace-1', 'ticket-1'), { ok: true, value: started });
  assert.deepEqual(asked, ['workspace-1/ticket-1']);
});

test('a conflict resolution names its workspace, ticket and reason', async () => {
  const { asked, handlers: door } = handlers();

  assert.deepEqual(await door.resolve('workspace-1', 'ticket-1', 'shared.txt'), {
    ok: true,
    value: started,
  });
  assert.deepEqual(await door.resolve('', 'ticket-1', 'shared.txt'), {
    ok: false,
    error: 'A run happens in a workspace.',
  });
  assert.deepEqual(await door.resolve('workspace-1', 'ticket-1', '   '), {
    ok: false,
    error: 'A conflict needs a reason.',
  });
  assert.deepEqual(asked, ['resolve workspace-1/ticket-1: shared.txt']);
});

test('a run names a workspace', async () => {
  const { asked, handlers: door } = handlers();

  assert.deepEqual(await door.start('', 'ticket-1'), {
    ok: false,
    error: 'A run happens in a workspace.',
  });
  assert.deepEqual(await door.start(null, 'ticket-1'), {
    ok: false,
    error: 'A run happens in a workspace.',
  });
  assert.deepEqual(asked, []);
});

test('a run names a ticket', async () => {
  const { asked, handlers: door } = handlers();

  assert.deepEqual(await door.start('workspace-1', 7), {
    ok: false,
    error: 'A run happens on a ticket.',
  });
  assert.deepEqual(asked, []);
});

test('a refusal reaches the window as the server’s own sentence', async () => {
  const { handlers: door } = handlers({
    start: async () => {
      throw new Error('A ticket an agent runs has to be ready first.');
    },
  });

  assert.deepEqual(await door.start('workspace-1', 'ticket-1'), {
    ok: false,
    error: 'A ticket an agent runs has to be ready first.',
  });
});

test('a transcript is read for a ticket and a run, and for nothing without both', async () => {
  const line: TicketSaid = {
    id: 'said-1',
    saidBy: 'agent',
    words: 'It is done.',
    at: '2026-01-01T00:00:00.000Z',
  };
  const { asked, handlers: door } = handlers();
  assert.deepEqual(await door.transcript('ticket-1', 'run-1'), { ok: true, value: [] });
  assert.deepEqual(asked, ['ticket-1/run-1']);

  const { handlers: giving } = handlers({ transcript: async () => [line] });
  assert.deepEqual(await giving.transcript('ticket-1', 'run-1'), { ok: true, value: [line] });

  assert.deepEqual(await door.transcript('', 'run-1'), {
    ok: false,
    error: 'A transcript is of a ticket.',
  });
  assert.deepEqual(await door.transcript('ticket-1', null), {
    ok: false,
    error: 'A transcript is of a run.',
  });
});
