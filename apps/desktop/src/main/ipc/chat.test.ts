import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatMessage, ChatMode, ChatState } from '../../preload/bridge.ts';
import { type ChatDeps, type ChatHandlers, chatHandlers } from './chat.ts';

/**
 * The renderer seam's job is to answer, never to throw: a rejected handler
 * crosses the process boundary as an opaque Error and leaves the renderer with
 * a dead promise. These cases pin what the renderer actually receives, and that
 * the call reached the conversation it was meant for.
 */
interface Case {
  name: string;
  makeDeps: (calls: string[]) => ChatDeps;
  call: keyof ChatHandlers;
  argument?: unknown;
  /** The lane a queued message names, for the cases that queue one. */
  lane?: unknown;
  want: unknown;
  wantCalls: string[];
}

const line: ChatMessage = {
  id: 'entry-1',
  parentId: null,
  role: 'you',
  parts: [{ type: 'text', text: 'hello' }],
};

const surface: ChatState = {
  chats: [
    {
      id: 'first',
      title: 'hello',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      workspaceId: null,
      ticketId: null,
    },
  ],
  workspaces: [],
  currentId: 'first',
  mode: 'build',
  draftId: null,
  transcript: { messages: [line], trailing: [], headId: 'entry-1' },
  memory: [{ kind: 'goal', at: '2026-01-01T00:00:00.000Z', text: 'fix the auth bug' }],
  conclusions: [{ text: 'the bug is in the session lookup', coversThrough: 3 }],
  running: [],
  streaming: null,
  queued: [],
  modelId: 'gpt-6-astra',
  chatUsage: { spent: 1_200, context: { tokens: 4_000, window: 128_000 } },
};

/** Deps that record what they were asked to do; `overrides` replace one of them. */
function deps(calls: string[], overrides: Partial<ChatDeps> = {}): ChatDeps {
  return {
    state: () => {
      calls.push('state');
      return surface;
    },
    send: async (text) => {
      calls.push(`send ${text}`);
    },
    stop: async () => {
      calls.push('stop');
      return [];
    },
    compact: async () => {
      calls.push('compact');
    },
    queue: async (text, lane) => {
      calls.push(`queue ${lane} ${text}`);
    },
    takeQueuedBack: () => {
      calls.push('unqueue');
      return [];
    },
    start: async (workspaceId) => {
      calls.push(`start ${workspaceId ?? 'nowhere'}`);
    },
    open: async (id) => {
      calls.push(`open ${id}`);
    },
    branch: async (messageId) => {
      calls.push(`branch ${messageId}`);
    },
    edit: async (messageId) => {
      calls.push(`edit ${messageId}`);
    },
    fork: async (messageId) => {
      calls.push(`fork ${messageId}`);
    },
    archiveChat: async (id) => {
      calls.push(`archive ${id}`);
    },
    restoreChat: async (id) => {
      calls.push(`restore ${id}`);
    },
    deleteChat: async (id) => {
      calls.push(`delete ${id}`);
    },
    ...overrides,
  };
}

const CASES: Case[] = [
  {
    name: 'load returns the whole surface',
    makeDeps: (calls) => deps(calls),
    call: 'load',
    want: { ok: true, value: surface },
    wantCalls: ['state'],
  },
  {
    name: 'load reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        state: () => {
          throw new Error('no conversation is open');
        },
      }),
    call: 'load',
    want: { ok: false, error: 'no conversation is open' },
    wantCalls: [],
  },
  {
    name: 'send passes the text through',
    makeDeps: (calls) => deps(calls),
    call: 'send',
    argument: 'do the thing',
    want: { ok: true, value: null },
    wantCalls: ['send do the thing'],
  },
  {
    name: 'send reports a failed turn as a value',
    makeDeps: (calls) =>
      deps(calls, {
        send: async () => {
          throw new Error('the model refused');
        },
      }),
    call: 'send',
    argument: 'do the thing',
    want: { ok: false, error: 'the model refused' },
    wantCalls: [],
  },
  {
    name: 'stop reaches the chat on screen, and hands back what was waiting',
    makeDeps: (calls) => deps(calls),
    call: 'stop',
    want: { ok: true, value: [] },
    wantCalls: ['stop'],
  },
  {
    name: 'stop reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        stop: async () => {
          throw new Error('No chat is open.');
        },
      }),
    call: 'stop',
    want: { ok: false, error: 'No chat is open.' },
    wantCalls: [],
  },
  {
    name: 'compact reaches the chat on screen, and hands back nothing',
    makeDeps: (calls) => deps(calls),
    call: 'compact',
    want: { ok: true, value: null },
    wantCalls: ['compact'],
  },
  {
    name: 'a compaction that cannot be made comes back as a refusal, not a failure',
    makeDeps: (calls) =>
      deps(calls, {
        compact: async () => {
          throw new Error('No chat is open.');
        },
      }),
    call: 'compact',
    want: { ok: false, error: 'No chat is open.' },
    wantCalls: [],
  },
  {
    name: 'queue passes the words and the turn they wait for',
    makeDeps: (calls) => deps(calls),
    call: 'queue',
    argument: 'do the other thing',
    lane: 'next',
    want: { ok: true, value: null },
    wantCalls: ['queue next do the other thing'],
  },
  {
    name: 'queue takes the later lane too',
    makeDeps: (calls) => deps(calls),
    call: 'queue',
    argument: 'and then the tests',
    lane: 'later',
    want: { ok: true, value: null },
    wantCalls: ['queue later and then the tests'],
  },
  {
    name: 'queue refuses a turn that is not one',
    makeDeps: (calls) => deps(calls),
    call: 'queue',
    argument: 'whenever',
    lane: 'eventually',
    want: { ok: false, error: 'A message waits for her next step or for later.' },
    wantCalls: [],
  },
  {
    name: 'queue refuses empty text',
    makeDeps: (calls) => deps(calls),
    call: 'queue',
    argument: '   ',
    lane: 'next',
    want: { ok: false, error: 'A message needs some text.' },
    wantCalls: [],
  },
  {
    name: 'queue reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        queue: async () => {
          throw new Error('Kira is not listening in this chat.');
        },
      }),
    call: 'queue',
    argument: 'do the other thing',
    lane: 'next',
    want: { ok: false, error: 'Kira is not listening in this chat.' },
    wantCalls: [],
  },
  {
    name: 'unqueue hands back what was waiting',
    makeDeps: (calls) =>
      deps(calls, {
        takeQueuedBack: () => {
          calls.push('unqueue');
          return [{ lane: 'later', text: 'and then the tests' }];
        },
      }),
    call: 'unqueue',
    want: { ok: true, value: [{ lane: 'later', text: 'and then the tests' }] },
    wantCalls: ['unqueue'],
  },
  {
    name: 'unqueue reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        takeQueuedBack: () => {
          throw new Error('No chat is open.');
        },
      }),
    call: 'unqueue',
    want: { ok: false, error: 'No chat is open.' },
    wantCalls: [],
  },
  {
    name: 'send refuses empty text',
    makeDeps: (calls) => deps(calls, { send: async () => assert.fail('the turn ran') }),
    call: 'send',
    argument: '   ',
    want: { ok: false, error: 'A message needs some text.' },
    wantCalls: [],
  },
  {
    name: 'send refuses text that is not a string',
    makeDeps: (calls) => deps(calls, { send: async () => assert.fail('the turn ran') }),
    call: 'send',
    argument: { text: 'smuggled' },
    want: { ok: false, error: 'A message needs some text.' },
    wantCalls: [],
  },
  {
    name: 'start opens a new chat, filed nowhere',
    makeDeps: (calls) => deps(calls),
    call: 'start',
    argument: null,
    want: { ok: true, value: null },
    wantCalls: ['start nowhere'],
  },
  {
    name: 'start files a new chat under the workspace it names',
    makeDeps: (calls) => deps(calls),
    call: 'start',
    argument: 'api',
    want: { ok: true, value: null },
    wantCalls: ['start api'],
  },
  {
    name: 'start reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        start: async () => {
          throw new Error('the database is read-only');
        },
      }),
    call: 'start',
    argument: null,
    want: { ok: false, error: 'the database is read-only' },
    wantCalls: [],
  },
  {
    name: 'start refuses a workspace that is not named by an id',
    makeDeps: (calls) => deps(calls, { start: async () => assert.fail('a chat was started') }),
    call: 'start',
    argument: 42,
    want: { ok: false, error: 'A chat starts in a workspace or nowhere.' },
    wantCalls: [],
  },
  {
    name: 'start refuses a workspace named by nothing',
    makeDeps: (calls) => deps(calls, { start: async () => assert.fail('a chat was started') }),
    call: 'start',
    argument: '',
    want: { ok: false, error: 'A chat starts in a workspace or nowhere.' },
    wantCalls: [],
  },
  {
    name: 'open switches to the named chat',
    makeDeps: (calls) => deps(calls),
    call: 'open',
    argument: 'second',
    want: { ok: true, value: null },
    wantCalls: ['open second'],
  },
  {
    name: 'open reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        open: async () => {
          throw new Error('No thread stored with id gone.');
        },
      }),
    call: 'open',
    argument: 'gone',
    want: { ok: false, error: 'No thread stored with id gone.' },
    wantCalls: [],
  },
  {
    name: 'open refuses an id that is not a string',
    makeDeps: (calls) => deps(calls, { open: async () => assert.fail('the chat was opened') }),
    call: 'open',
    argument: 7,
    want: { ok: false, error: 'A chat needs an id.' },
    wantCalls: [],
  },
  {
    name: 'open refuses an empty id',
    makeDeps: (calls) => deps(calls, { open: async () => assert.fail('the chat was opened') }),
    call: 'open',
    argument: '',
    want: { ok: false, error: 'A chat needs an id.' },
    wantCalls: [],
  },
  {
    name: 'branch stands on the named message',
    makeDeps: (calls) => deps(calls),
    call: 'branch',
    argument: 'entry-1',
    want: { ok: true, value: null },
    wantCalls: ['branch entry-1'],
  },
  {
    name: 'branch reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        branch: async () => {
          throw new Error('Entry made-up not found');
        },
      }),
    call: 'branch',
    argument: 'made-up',
    want: { ok: false, error: 'Entry made-up not found' },
    wantCalls: [],
  },
  {
    name: 'branch refuses an id that is not a string',
    makeDeps: (calls) => deps(calls, { branch: async () => assert.fail('the branch moved') }),
    call: 'branch',
    argument: ['entry-1'],
    want: { ok: false, error: 'A branch needs a message id.' },
    wantCalls: [],
  },
  {
    name: 'branch refuses an empty id',
    makeDeps: (calls) => deps(calls, { branch: async () => assert.fail('the branch moved') }),
    call: 'branch',
    argument: '',
    want: { ok: false, error: 'A branch needs a message id.' },
    wantCalls: [],
  },
  {
    name: 'edit takes back the named message, ready to be said differently',
    makeDeps: (calls) => deps(calls),
    call: 'edit',
    argument: 'entry-1',
    want: { ok: true, value: null },
    wantCalls: ['edit entry-1'],
  },
  {
    name: 'edit reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        edit: async () => {
          throw new Error('Only your own message can be changed.');
        },
      }),
    call: 'edit',
    argument: 'entry-2',
    want: { ok: false, error: 'Only your own message can be changed.' },
    wantCalls: [],
  },
  {
    name: 'edit refuses an id that is not a string',
    makeDeps: (calls) =>
      deps(calls, { edit: async () => assert.fail('the message was taken back') }),
    call: 'edit',
    argument: 7,
    want: { ok: false, error: 'An edit needs a message id.' },
    wantCalls: [],
  },
  {
    name: 'edit refuses an empty id',
    makeDeps: (calls) =>
      deps(calls, { edit: async () => assert.fail('the message was taken back') }),
    call: 'edit',
    argument: '',
    want: { ok: false, error: 'An edit needs a message id.' },
    wantCalls: [],
  },
  {
    name: 'fork starts a chat from the named message',
    makeDeps: (calls) => deps(calls),
    call: 'fork',
    argument: 'entry-1',
    want: { ok: true, value: null },
    wantCalls: ['fork entry-1'],
  },
  {
    name: 'fork reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        fork: async () => {
          throw new Error('This chat has no message gone.');
        },
      }),
    call: 'fork',
    argument: 'gone',
    want: { ok: false, error: 'This chat has no message gone.' },
    wantCalls: [],
  },
  {
    name: 'fork refuses an id that is not a string',
    makeDeps: (calls) => deps(calls, { fork: async () => assert.fail('the chat was forked') }),
    call: 'fork',
    argument: undefined,
    want: { ok: false, error: 'A fork needs a message id.' },
    wantCalls: [],
  },
  {
    name: 'fork refuses an empty id',
    makeDeps: (calls) => deps(calls, { fork: async () => assert.fail('the chat was forked') }),
    call: 'fork',
    argument: '',
    want: { ok: false, error: 'A fork needs a message id.' },
    wantCalls: [],
  },
  {
    name: 'archive puts the named chat away',
    makeDeps: (calls) => deps(calls),
    call: 'archive',
    argument: 'first',
    want: { ok: true, value: null },
    wantCalls: ['archive first'],
  },
  {
    name: 'archive reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        archiveChat: async () => {
          throw new Error('Kira is writing in this chat.');
        },
      }),
    call: 'archive',
    argument: 'first',
    want: { ok: false, error: 'Kira is writing in this chat.' },
    wantCalls: [],
  },
  {
    name: 'archive refuses an id that is not a string',
    makeDeps: (calls) =>
      deps(calls, {
        archiveChat: async () => assert.fail('the chat was put away'),
      }),
    call: 'archive',
    argument: 7,
    want: { ok: false, error: 'A chat needs an id to be put away.' },
    wantCalls: [],
  },
  {
    name: 'archive refuses an empty id',
    makeDeps: (calls) =>
      deps(calls, {
        archiveChat: async () => assert.fail('the chat was put away'),
      }),
    call: 'archive',
    argument: '',
    want: { ok: false, error: 'A chat needs an id to be put away.' },
    wantCalls: [],
  },
  {
    name: 'restore brings the named chat back',
    makeDeps: (calls) => deps(calls),
    call: 'restore',
    argument: 'first',
    want: { ok: true, value: null },
    wantCalls: ['restore first'],
  },
  {
    name: 'restore refuses an id that is not a string',
    makeDeps: (calls) =>
      deps(calls, {
        restoreChat: async () => assert.fail('the chat was brought back'),
      }),
    call: 'restore',
    argument: 9,
    want: { ok: false, error: 'A chat needs an id to be brought back.' },
    wantCalls: [],
  },
  {
    name: 'restore refuses an empty id',
    makeDeps: (calls) =>
      deps(calls, {
        restoreChat: async () => assert.fail('the chat was brought back'),
      }),
    call: 'restore',
    argument: '',
    want: { ok: false, error: 'A chat needs an id to be brought back.' },
    wantCalls: [],
  },
  {
    name: 'delete throws the named chat away',
    makeDeps: (calls) => deps(calls),
    call: 'delete',
    argument: 'first',
    want: { ok: true, value: null },
    wantCalls: ['delete first'],
  },
  {
    name: 'delete reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        deleteChat: async () => {
          throw new Error('Kira is writing in this chat.');
        },
      }),
    call: 'delete',
    argument: 'first',
    want: { ok: false, error: 'Kira is writing in this chat.' },
    wantCalls: [],
  },
  {
    name: 'delete refuses an id that is not a string',
    makeDeps: (calls) =>
      deps(calls, {
        deleteChat: async () => assert.fail('the chat was deleted'),
      }),
    call: 'delete',
    argument: ['first'],
    want: { ok: false, error: 'A chat needs an id to be deleted.' },
    wantCalls: [],
  },
  {
    name: 'delete refuses an empty id',
    makeDeps: (calls) =>
      deps(calls, {
        deleteChat: async () => assert.fail('the chat was deleted'),
      }),
    call: 'delete',
    argument: '',
    want: { ok: false, error: 'A chat needs an id to be deleted.' },
    wantCalls: [],
  },
];

for (const testCase of CASES) {
  test(testCase.name, async () => {
    const calls: string[] = [];
    const handlers = chatHandlers(testCase.makeDeps(calls));
    const run = {
      load: () => handlers.load(),
      send: () => handlers.send(testCase.argument),
      setMode: () => handlers.setMode(testCase.argument as ChatMode),
      queue: () => handlers.queue(testCase.argument, testCase.lane),
      unqueue: () => handlers.unqueue(),
      stop: () => handlers.stop(),
      compact: () => handlers.compact(),
      start: () => handlers.start(testCase.argument),
      open: () => handlers.open(testCase.argument),
      branch: () => handlers.branch(testCase.argument),
      edit: () => handlers.edit(testCase.argument),
      fork: () => handlers.fork(testCase.argument),
      archive: () => handlers.archive(testCase.argument),
      restore: () => handlers.restore(testCase.argument),
      delete: () => handlers.delete(testCase.argument),
    } as const;

    assert.deepEqual(await run[testCase.call](), testCase.want);
    assert.deepEqual(calls, testCase.wantCalls);
  });
}

test('retrying breakdown readiness is routed through the chat seam', async () => {
  const calls: string[] = [];
  const handlers = chatHandlers(
    deps(calls, {
      retryBreakdownReady: async () => {
        calls.push('retryBreakdownReady');
      },
    }),
  );

  assert.deepEqual(await handlers.retryBreakdownReady(), { ok: true, value: null });
  assert.deepEqual(calls, ['retryBreakdownReady']);
});

test('changing mode validates and forwards the selected mode', async () => {
  const calls: string[] = [];
  const handlers = chatHandlers(
    deps(calls, {
      setMode: async (mode) => {
        calls.push(`mode ${mode}`);
      },
    }),
  );

  assert.deepEqual(await handlers.setMode('spec'), { ok: true, value: null });
  assert.deepEqual(await handlers.setMode('unsafe'), {
    ok: false,
    error: 'A chat mode must be Build or Spec.',
  });
  assert.deepEqual(calls, ['mode spec']);
});

test('approving and rejecting a proposal are person actions routed through the chat seam', async () => {
  const refuse = async (): Promise<void> => {
    throw new Error('That proposal is no longer waiting for a decision.');
  };
  const cases: Array<{
    name: string;
    call: 'approveProposal' | 'rejectProposal';
    argument: unknown;
    overrides?: Partial<ChatDeps>;
    want: unknown;
    wantCalls: string[];
  }> = [
    {
      name: 'approve',
      call: 'approveProposal',
      argument: 'proposal-1',
      want: { ok: true, value: null },
      wantCalls: ['approveProposal proposal-1'],
    },
    {
      name: 'reject',
      call: 'rejectProposal',
      argument: 'proposal-1',
      want: { ok: true, value: null },
      wantCalls: ['rejectProposal proposal-1'],
    },
    {
      name: 'approve without an id',
      call: 'approveProposal',
      argument: '',
      want: { ok: false, error: 'A proposal needs an id.' },
      wantCalls: [],
    },
    {
      name: 'reject with an id that is not a string',
      call: 'rejectProposal',
      argument: 42,
      want: { ok: false, error: 'A proposal needs an id.' },
      wantCalls: [],
    },
    {
      name: 'the main process refuses a proposal that is no longer waiting',
      call: 'approveProposal',
      argument: 'proposal-old',
      overrides: { approveProposal: refuse },
      want: { ok: false, error: 'That proposal is no longer waiting for a decision.' },
      wantCalls: [],
    },
  ];

  for (const item of cases) {
    const calls: string[] = [];
    const handlers = chatHandlers(
      deps(calls, {
        approveProposal: async (id) => {
          calls.push(`approveProposal ${id}`);
        },
        rejectProposal: async (id) => {
          calls.push(`rejectProposal ${id}`);
        },
        ...item.overrides,
      }),
    );

    assert.deepEqual(await handlers[item.call](item.argument), item.want, item.name);
    assert.deepEqual(calls, item.wantCalls, item.name);
  }
});

test('questionnaire submissions require and preserve both chat and request ids', async () => {
  const calls: unknown[][] = [];
  const handlers = chatHandlers(
    deps([], {
      answerQuestionnaire: (threadId, requestId, result) => {
        calls.push(['answer', threadId, requestId, result]);
        return true;
      },
      cancelQuestionnaire: (threadId, requestId) => {
        calls.push(['cancel', threadId, requestId]);
        return true;
      },
    }),
  );
  const payload = { answers: [], cancelled: false };

  assert.deepEqual(await handlers.answerQuestionnaire('', 'request-1', payload), {
    ok: false,
    error: 'A question needs a chat and request id.',
  });
  assert.deepEqual(await handlers.answerQuestionnaire('chat-1', 'request-1', payload), {
    ok: true,
    value: null,
  });
  assert.deepEqual(await handlers.cancelQuestionnaire('chat-1', 'request-1'), {
    ok: true,
    value: null,
  });
  assert.deepEqual(calls, [
    ['answer', 'chat-1', 'request-1', payload],
    ['cancel', 'chat-1', 'request-1'],
  ]);
});
