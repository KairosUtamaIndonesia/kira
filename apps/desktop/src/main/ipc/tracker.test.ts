import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  TICKET_KINDS,
  type Ticket,
  type TicketDraft,
  type TicketQueue,
} from '../../preload/bridge.ts';
import {
  type QuestionTrackerHandlers,
  type TrackerDeps,
  type TrackerHandlers,
  trackerHandlers,
} from './tracker.ts';

/**
 * The tracker's handlers, over a server that is not here.
 *
 * What these add is the check that the window sent something a server could be
 * asked: the window is an input to be checked rather than a caller to be believed
 * (./result.ts). Everything a person reads about *why* something was refused comes
 * from the server, so a refusal is passed through untouched — and the cases below
 * are the ones where there is nothing to pass through because the request never
 * reached it.
 */
interface Case {
  name: string;
  makeDeps: (calls: string[]) => TrackerDeps;
  call: keyof TrackerHandlers;
  args?: unknown[];
  want: unknown;
  wantCalls: string[];
}

const ticket: Ticket = {
  id: 'ticket-1',
  projectId: 'foundry-project',
  name: 'FND-1',
  number: 1,
  kind: 'feature',
  title: 'Add acceptance criteria',
  body: 'A ticket says how it is known to be done.',
  criteria: ['A criterion is one line'],
  gate: 'draft',
  band: 'draft',
  rank: 1,
  branch: 'fnd-1-add-acceptance-criteria',
  author: { id: 'ada', name: 'Ada Lovelace' },
  gates: [],
  children: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  closedAt: null,
  closure: null,
  claim: null,
  runs: [],
};

const queue: TicketQueue = {
  project: { id: 'foundry-project', name: 'Foundry', prefix: 'FND' },
  tickets: [ticket],
  counts: { draft: 1, ready: 0, blocked: 0, running: 0, 'needs-you': 0, done: 0 },
};

const draft: TicketDraft = {
  kind: 'feature',
  title: 'Add acceptance criteria',
  body: 'A ticket says how it is known to be done.',
  criteria: ['A criterion is one line'],
};

/** Deps that record what they were asked to do; `overrides` replace one of them. */
function deps(calls: string[], overrides: Partial<TrackerDeps> = {}): TrackerDeps {
  return {
    queue: async (workspaceId) => {
      calls.push(`queue ${workspaceId}`);
      return queue;
    },
    write: async (workspaceId, written) => {
      calls.push(`write ${workspaceId} ${JSON.stringify(written)}`);
      return ticket;
    },
    change: async (ticketId, change) => {
      calls.push(`change ${ticketId} ${JSON.stringify(change)}`);
      return ticket;
    },
    gate: async (ticketId, gatedBy) => {
      calls.push(`gate ${ticketId} ${gatedBy}`);
      return ticket;
    },
    ungate: async (ticketId, gatedBy) => {
      calls.push(`ungate ${ticketId} ${gatedBy}`);
      return ticket;
    },
    ...overrides,
  };
}

const CASES: Case[] = [
  {
    name: 'queue reads the queue of the workspace it was asked for',
    makeDeps: (calls) => deps(calls),
    call: 'queue',
    args: ['api'],
    want: { ok: true, value: queue },
    wantCalls: ['queue api'],
  },
  {
    name: 'queue refuses a workspace that is not named by an id',
    makeDeps: (calls) => deps(calls, { queue: async () => assert.fail('a queue was read') }),
    call: 'queue',
    args: [undefined],
    want: { ok: false, error: 'A queue is read for a workspace.' },
    wantCalls: [],
  },
  {
    name: 'queue says why there is no queue rather than answering an empty one',
    makeDeps: (calls) =>
      deps(calls, {
        queue: async () => {
          throw new Error('This folder is not working a project yet.');
        },
      }),
    call: 'queue',
    args: ['api'],
    want: { ok: false, error: 'This folder is not working a project yet.' },
    wantCalls: [],
  },
  {
    name: 'write writes a ticket down in the workspace it was asked for',
    makeDeps: (calls) => deps(calls),
    call: 'write',
    args: ['api', draft],
    want: { ok: true, value: ticket },
    wantCalls: [`write api ${JSON.stringify(draft)}`],
  },
  {
    name: 'write takes a ticket with nothing in it, because capturing an idea owes nothing',
    makeDeps: (calls) => deps(calls),
    call: 'write',
    args: ['api', { kind: 'feature', title: '', body: '', criteria: [] }],
    want: { ok: true, value: ticket },
    wantCalls: ['write api {"kind":"feature","title":"","body":"","criteria":[]}'],
  },
  {
    name: 'write refuses a kind that is not one of the eight',
    makeDeps: (calls) => deps(calls, { write: async () => assert.fail('a ticket was written') }),
    call: 'write',
    args: ['api', { ...draft, kind: 'epic' }],
    want: { ok: false, error: 'That is not a ticket to write.' },
    wantCalls: [],
  },
  {
    name: 'write refuses criteria that are not lines of text',
    makeDeps: (calls) => deps(calls, { write: async () => assert.fail('a ticket was written') }),
    call: 'write',
    args: ['api', { ...draft, criteria: ['fine', 7] }],
    want: { ok: false, error: 'That is not a ticket to write.' },
    wantCalls: [],
  },
  {
    name: 'write refuses a ticket with no title to write it under',
    makeDeps: (calls) => deps(calls, { write: async () => assert.fail('a ticket was written') }),
    call: 'write',
    args: ['api', { kind: 'feature', body: '', criteria: [] }],
    want: { ok: false, error: 'That is not a ticket to write.' },
    wantCalls: [],
  },
  {
    name: 'write passes the server’s refusal through in the server’s own words',
    makeDeps: (calls) =>
      deps(calls, {
        write: async () => {
          throw new Error('A ticket an agent runs has to say how it is known to be done.');
        },
      }),
    call: 'write',
    args: ['api', draft],
    want: { ok: false, error: 'A ticket an agent runs has to say how it is known to be done.' },
    wantCalls: [],
  },
  {
    name: 'change writes what was asked about a ticket',
    makeDeps: (calls) => deps(calls),
    call: 'change',
    args: ['ticket-1', { title: 'A better name', gate: 'ready-for-agent', rank: 0 }],
    want: { ok: true, value: ticket },
    wantCalls: ['change ticket-1 {"title":"A better name","gate":"ready-for-agent","rank":0}'],
  },
  {
    name: 'change takes a closure on its own, which is how a ticket is finished',
    makeDeps: (calls) => deps(calls),
    call: 'change',
    args: ['ticket-1', { closure: 'wontfix' }],
    want: { ok: true, value: ticket },
    wantCalls: ['change ticket-1 {"closure":"wontfix"}'],
  },
  {
    name: 'change refuses a gate that is not one of the three',
    makeDeps: (calls) => deps(calls, { change: async () => assert.fail('a ticket was changed') }),
    call: 'change',
    args: ['ticket-1', { gate: 'ready' }],
    want: { ok: false, error: 'That is not a change to a ticket.' },
    wantCalls: [],
  },
  {
    name: 'change refuses a closure that is not one of the two reasons',
    makeDeps: (calls) => deps(calls, { change: async () => assert.fail('a ticket was changed') }),
    call: 'change',
    args: ['ticket-1', { closure: 'abandoned' }],
    want: { ok: false, error: 'That is not a change to a ticket.' },
    wantCalls: [],
  },
  {
    name: 'change refuses a rank that is not a whole number',
    makeDeps: (calls) => deps(calls, { change: async () => assert.fail('a ticket was changed') }),
    call: 'change',
    args: ['ticket-1', { rank: 1.5 }],
    want: { ok: false, error: 'That is not a change to a ticket.' },
    wantCalls: [],
  },
  {
    name: 'change drops a kind, which is fixed when a ticket is written',
    makeDeps: (calls) => deps(calls),
    call: 'change',
    args: ['ticket-1', { kind: 'bug' }],
    want: { ok: true, value: ticket },
    wantCalls: ['change ticket-1 {}'],
  },
  {
    name: 'change refuses a ticket that is not named by an id',
    makeDeps: (calls) => deps(calls, { change: async () => assert.fail('a ticket was changed') }),
    call: 'change',
    args: ['', { title: 'A better name' }],
    want: { ok: false, error: 'A ticket needs an id to be changed.' },
    wantCalls: [],
  },
  {
    name: 'gate names a ticket by whatever a person would say',
    makeDeps: (calls) => deps(calls),
    call: 'gate',
    args: ['ticket-1', 'FND-2'],
    want: { ok: true, value: ticket },
    wantCalls: ['gate ticket-1 FND-2'],
  },
  {
    name: 'gate refuses a gate that names nothing',
    makeDeps: (calls) => deps(calls, { gate: async () => assert.fail('a gate was added') }),
    call: 'gate',
    args: ['ticket-1', '   '],
    want: { ok: false, error: 'A gate names a ticket.' },
    wantCalls: [],
  },
  {
    name: 'gate refuses a ticket that is not named by an id',
    makeDeps: (calls) => deps(calls, { gate: async () => assert.fail('a gate was added') }),
    call: 'gate',
    args: [undefined, 'FND-2'],
    want: { ok: false, error: 'A ticket needs an id to be gated.' },
    wantCalls: [],
  },
  {
    name: 'gate passes the server’s refusal through, so a circle is shown as one',
    makeDeps: (calls) =>
      deps(calls, {
        gate: async () => {
          throw new Error('That gate would close a circle of tickets.');
        },
      }),
    call: 'gate',
    args: ['ticket-1', 'FND-2'],
    want: { ok: false, error: 'That gate would close a circle of tickets.' },
    wantCalls: [],
  },
  {
    name: 'ungate takes a named gate off',
    makeDeps: (calls) => deps(calls),
    call: 'ungate',
    args: ['ticket-1', 'FND-2'],
    want: { ok: true, value: ticket },
    wantCalls: ['ungate ticket-1 FND-2'],
  },
  {
    name: 'ungate refuses a ticket that is not named by an id',
    makeDeps: (calls) => deps(calls, { ungate: async () => assert.fail('a gate was removed') }),
    call: 'ungate',
    args: ['', 'FND-2'],
    want: { ok: false, error: 'A ticket needs an id to be ungated.' },
    wantCalls: [],
  },
];

test('write accepts each of the eight ticket kinds', async () => {
  for (const kind of TICKET_KINDS) {
    const calls: string[] = [];
    const handlers = trackerHandlers(deps(calls));
    const result = await handlers.write('api', { ...draft, kind });

    assert.deepEqual(result, { ok: true, value: ticket }, kind);
    assert.deepEqual(calls, [`write api ${JSON.stringify({ ...draft, kind })}`], kind);
  }
});

test('undoGlossary validates the visible version and preserves the server refusal', async () => {
  const calls: string[] = [];
  const handlers = trackerHandlers(
    deps(calls, {
      undoGlossary: async (workspaceId, entryId, version, chatId) => {
        calls.push(`undo ${workspaceId} ${entryId} ${version} ${chatId}`);
        throw new Error('That glossary change is no longer current.');
      },
    }),
  );

  assert.deepEqual(await handlers.undoGlossary('workspace-1', 'entry-1', 2, 'chat-1'), {
    ok: false,
    error: 'That glossary change is no longer current.',
  });
  assert.deepEqual(calls, ['undo workspace-1 entry-1 2 chat-1']);
  assert.deepEqual(await handlers.undoGlossary('', 'entry-1', 2, 'chat-1'), {
    ok: false,
    error: 'A glossary is undone in a workspace.',
  });
  assert.deepEqual(await handlers.undoGlossary('workspace-1', 'entry-1', 0, 'chat-1'), {
    ok: false,
    error: 'A glossary Undo needs a version.',
  });
});

for (const testCase of CASES) {
  test(testCase.name, async () => {
    const calls: string[] = [];
    const handlers = trackerHandlers(testCase.makeDeps(calls));
    const [first, second] = testCase.args ?? [];
    const run = {
      queue: () => handlers.queue(first),
      write: () => handlers.write(first, second),
      change: () => handlers.change(first, second),
      gate: () => handlers.gate(first, second),
      ungate: () => handlers.ungate(first, second),
      undoGlossary: () => handlers.undoGlossary(first, second, undefined, undefined),
    } as const;

    assert.deepEqual(await run[testCase.call](), testCase.want);
    assert.deepEqual(calls, testCase.wantCalls);
  });
}

test('question chat validates the workspace and ticket before forwarding the person action', async () => {
  const calls: string[] = [];
  const handlers = trackerHandlers(
    deps(calls, {
      openQuestion: async (workspaceId, ticketId) => {
        calls.push(`question ${workspaceId} ${ticketId}`);
        return ticket;
      },
    }),
  ) as TrackerHandlers & QuestionTrackerHandlers;

  assert.deepEqual(await handlers.questionChat('workspace-1', 'ticket-1'), {
    ok: true,
    value: ticket,
  });
  assert.deepEqual(await handlers.questionChat('', 'ticket-1'), {
    ok: false,
    error: 'A question chat starts in a workspace.',
  });
  assert.deepEqual(await handlers.questionChat('workspace-1', ''), {
    ok: false,
    error: 'A question chat needs a ticket.',
  });
  assert.deepEqual(calls, ['question workspace-1 ticket-1']);
});
