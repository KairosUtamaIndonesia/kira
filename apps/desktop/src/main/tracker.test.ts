import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type {
  GlossaryEdit,
  GlossaryEntry,
  GitConnection,
  MapProposal,
  ProjectDecision,
  ProjectSummary,
  Repository,
  Ticket,
  TicketComment,
  TicketDraft,
  TicketQueue,
  TimelineEntry,
  WorkspaceSummary,
} from '../preload/bridge.ts';
import {
  NOBODY_SIGNED_IN,
  NO_PROJECT,
  trackerFor,
  UNREACHABLE,
  type TrackerWire,
} from './tracker.ts';

/**
 * The tracker as the main process answers it, over a server that is not here.
 *
 * What this adds to the channel handlers' own tests is the part only this side can
 * decide: which project a folder works — a fact in the desktop's database, not the
 * server's — and what a person is told when the server answers nothing, refuses, or
 * has stopped honouring the key this machine holds. Those three are apart on
 * purpose, and this is where that is checked.
 */
const project: ProjectSummary = { id: 'kira-project', name: 'Kira', prefix: 'FND' };

const workspace: WorkspaceSummary = {
  id: 'api',
  name: 'api',
  folder: '/work/api',
  projectId: project.id,
};

const ticket: Ticket = {
  id: 'ticket-1',
  projectId: project.id,
  name: 'FND-1',
  number: 1,
  kind: 'feature',
  title: 'A ticket',
  body: '',
  criteria: [],
  status: 'draft',
  blocked: false,
  rank: 1,
  priority: 'none',
  pullRequestUrl: null,
  assignee: null,
  tags: [],
  author: null,
  gates: [],
  children: [],
  parent: null,
  subIssues: [],
  relationships: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const queue: TicketQueue = {
  project,
  tickets: [ticket],
  counts: { draft: 1, ready: 0, running: 0, 'needs-review': 0, done: 0, 'wont-do': 0 },
};

const draft: TicketDraft = { kind: 'feature', title: 'A ticket', body: '', criteria: [] };

const comment: TicketComment = {
  id: 'comment-1',
  ticketId: ticket.id,
  parentId: null,
  author: { id: 'ada', name: 'Ada' },
  authorKind: 'kira',
  body: 'Working on it.',
  deleted: false,
  mine: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const timeline: TimelineEntry[] = [
  {
    type: 'comment',
    id: comment.id,
    parentId: comment.parentId,
    author: comment.author,
    authorKind: comment.authorKind,
    body: comment.body,
    deleted: comment.deleted,
    mine: comment.mine,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  },
];

const repository: Repository = {
  id: 'repo-1',
  projectId: project.id,
  provider: 'github',
  owner: 'acme',
  name: 'api',
  defaultBranch: 'main',
};

const connection: GitConnection = {
  id: 'conn-1',
  provider: 'forgejo',
  authKind: 'token',
  instanceUrl: 'https://git.example.com',
  accountLogin: 'acme',
  accountType: 'User',
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** A wire that answers whatever one case needs, and records what it was asked. */
function wire(calls: string[], answers: Partial<TrackerWire> = {}): TrackerWire {
  return {
    currentUser: async (key) => {
      calls.push(`currentUser ${key}`);
      return { kind: 'ok', body: { id: 'ada' } };
    },
    projects: async (key) => {
      calls.push(`projects ${key}`);
      return { kind: 'ok', body: [project] };
    },
    createProject: async (key, made) => {
      calls.push(`createProject ${key} ${made.name} ${made.prefix}`);
      return { kind: 'ok', body: project };
    },
    queue: async (key, projectId) => {
      calls.push(`queue ${key} ${projectId}`);
      return { kind: 'ok', body: queue };
    },
    writeTicket: async (key, projectId, written) => {
      calls.push(`writeTicket ${key} ${projectId} ${written.title}`);
      return { kind: 'ok', body: ticket };
    },
    changeTicket: async (key, ticketId, change) => {
      calls.push(`changeTicket ${key} ${ticketId} ${JSON.stringify(change)}`);
      return { kind: 'ok', body: ticket };
    },
    gateTicket: async (key, ticketId, gatedBy) => {
      calls.push(`gateTicket ${key} ${ticketId} ${gatedBy}`);
      return { kind: 'ok', body: ticket };
    },
    ungateTicket: async (key, ticketId, gatedBy) => {
      calls.push(`ungateTicket ${key} ${ticketId} ${gatedBy}`);
      return { kind: 'ok', body: ticket };
    },
    timeline: async (key, ticketId, limit) => {
      calls.push(`timeline ${key} ${ticketId} ${limit ?? ''}`);
      return { kind: 'ok', body: timeline };
    },
    comment: async (key, ticketId, body, parentId, authorKind) => {
      calls.push(`comment ${key} ${ticketId} ${body} ${parentId ?? ''} ${authorKind ?? ''}`);
      return { kind: 'ok', body: comment };
    },
    editComment: async (key, commentId, body) => {
      calls.push(`editComment ${key} ${commentId} ${body}`);
      return { kind: 'ok', body: { ...comment, body } };
    },
    deleteComment: async (key, commentId) => {
      calls.push(`deleteComment ${key} ${commentId}`);
      return { kind: 'ok', body: true };
    },
    pullRequests: async (key, ticketId) => {
      calls.push(`pullRequests ${key} ${ticketId}`);
      return { kind: 'ok', body: [] };
    },
    repositories: async (key, projectId) => {
      calls.push(`repositories ${key} ${projectId}`);
      return { kind: 'ok', body: [repository] };
    },
    attachRepository: async (key, projectId, input) => {
      calls.push(`attachRepository ${key} ${projectId} ${input.owner}/${input.name}`);
      return { kind: 'ok', body: repository };
    },
    detachRepository: async (key, projectId, id) => {
      calls.push(`detachRepository ${key} ${projectId} ${id}`);
      return { kind: 'ok', body: true };
    },
    connections: async (key) => {
      calls.push(`connections ${key}`);
      return { kind: 'ok', body: [] };
    },
    connectHost: async (key, input) => {
      calls.push(`connectHost ${key} ${input.provider}`);
      return { kind: 'ok', body: { connection: connection, webhookSecret: 'a-secret' } };
    },
    disconnectHost: async (key, id) => {
      calls.push(`disconnectHost ${key} ${id}`);
      return { kind: 'ok', body: true };
    },
    githubConnect: async (key) => {
      calls.push(`githubConnect ${key}`);
      return { kind: 'ok', body: { configured: false, url: null } };
    },
    readTicket: async (key, ref) => {
      calls.push(`readTicket ${key} ${ref}`);
      return { kind: 'ok', body: ticket };
    },
    ...answers,
  };
}

/** The tracker over that wire, with a key and a folder that works a project. */
function tracker(calls: string[], answers: Partial<TrackerWire> = {}, held: string | null = 'key') {
  const joined: WorkspaceSummary[] = [];

  return {
    joined,
    held: trackerFor({
      token: async () => held,
      projectOf: (workspaceId) => (workspaceId === workspace.id ? project.id : null),
      joinLocally: (workspaceId, projectId) => {
        if (workspaceId !== workspace.id) return undefined;
        const next = { ...workspace, projectId };
        joined.push(next);
        return next;
      },
      wire: wire(calls, answers),
    }),
  };
}

/** What a call came to: the value, or the sentence a person would read. */
async function tried(act: () => Promise<unknown>): Promise<string> {
  try {
    const value = await act();
    return `ok ${JSON.stringify(value).slice(0, 40)}`;
  } catch (error) {
    return `refused ${error instanceof Error ? error.message : String(error)}`;
  }
}

test('a queue is read for the project the folder works, with the key this machine holds', async () => {
  const calls: string[] = [];
  const held = tracker(calls);

  assert.deepEqual(await held.held.queue(workspace.id), queue);
  assert.deepEqual(calls, ['queue key kira-project']);
});

test('a ticket is read through the same key-bearing tracker seam', async () => {
  const calls: string[] = [];
  const held = tracker(calls);

  assert.deepEqual(await held.held.readTicket(ticket.name), ticket);
  assert.deepEqual(calls, ['readTicket key FND-1']);
});

test('Decision reads and person approvals use the key-bearing tracker seam', async () => {
  const calls: string[] = [];
  const decision: ProjectDecision = {
    id: 'decision-1',
    projectId: project.id,
    context: 'The project needs a durable choice.',
    choice: 'Keep it in the tracker.',
    rejectedOptions: ['Keep it in chat.'],
    consequences: 'Runs can read it.',
    author: null,
    sourceChatId: 'chat-1',
    supersededById: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const proposal = {
    context: decision.context,
    choice: decision.choice,
    rejectedOptions: decision.rejectedOptions,
    consequences: decision.consequences,
    supersedes: null,
  };
  const held = tracker(calls, {
    decisions: async (key, projectId) => {
      calls.push(`decisions ${key} ${projectId}`);
      return { kind: 'ok', body: [decision] };
    },
    createDecision: async (key, projectId, approved) => {
      calls.push(`createDecision ${key} ${projectId} ${approved.sourceChatId}`);
      return { kind: 'ok', body: decision };
    },
  });

  assert.deepEqual(await held.held.decisions?.(workspace.id), [decision]);
  assert.deepEqual(await held.held.approveDecision(workspace.id, proposal, 'chat-1'), decision);
  assert.deepEqual(calls, ['decisions key kira-project', 'createDecision key kira-project chat-1']);
});

test('map creation and destination approval use the person-owned tracker seam', async () => {
  const calls: string[] = [];
  const destination = { ...ticket, kind: 'spec', status: 'ready' } as Ticket;
  const proposal: Omit<MapProposal, 'id' | 'chatId' | 'status' | 'ticketId'> = {
    title: 'Scale',
    body: 'Break it down.',
    criteria: ['The destination is clear.'],
    questions: [],
    research: [],
  };
  const held = tracker(calls, {
    createMap: async (key, projectId, approved) => {
      calls.push(`createMap ${key} ${projectId} ${approved.sourceChatId}`);
      return { kind: 'ok', body: ticket };
    },
    approveDestinationSpec: async (key, mapTicketId, draft) => {
      calls.push(`approveDestinationSpec ${key} ${mapTicketId} ${draft.title}`);
      return { kind: 'ok', body: destination };
    },
  });

  assert.deepEqual(await held.held.createMap?.(workspace.id, proposal, 'map-chat'), ticket);
  assert.deepEqual(
    await held.held.approveDestinationSpec?.(workspace.id, 'map-1', {
      kind: 'spec',
      title: 'Destination',
      body: 'The destination.',
      criteria: ['It is sliced.'],
    }),
    destination,
  );
  assert.deepEqual(calls, [
    'createMap key kira-project map-chat',
    'approveDestinationSpec key map-1 Destination',
  ]);
});

test('project glossary reads include current terms and their history', async () => {
  const calls: string[] = [];
  const glossary: GlossaryEntry[] = [
    {
      id: 'term-1',
      projectId: project.id,
      term: 'ticket',
      meaning: 'a bounded unit of work',
      wordsToAvoid: ['issue'],
      version: 2,
      author: { id: 'ada', name: 'Ada Lovelace' },
      chatId: 'chat-2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      history: [
        {
          version: 1,
          term: 'ticket',
          meaning: 'a bounded unit',
          wordsToAvoid: [],
          author: { id: 'ada', name: 'Ada Lovelace' },
          chatId: 'chat-1',
          changedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  ];
  const held = tracker(calls, {
    glossary: async (key, projectId) => {
      calls.push(`glossary ${key} ${projectId}`);
      return { kind: 'ok', body: glossary };
    },
    decisions: async (key, projectId) => {
      calls.push(`decisions ${key} ${projectId}`);
      return {
        kind: 'ok',
        body: [
          {
            id: 'decision-1',
            projectId,
            context: 'The project needs a durable choice.',
            choice: 'Use the tracker',
            rejectedOptions: ['Keep it in chat'],
            consequences: 'Runs can read it.',
            author: null,
            sourceChatId: null,
            supersededById: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
    },
  });

  assert.deepEqual(await held.held.glossary?.(workspace.id), glossary);
  assert.deepEqual((await held.held.decisions?.(workspace.id))?.[0]?.choice, 'Use the tracker');
  assert.deepEqual(calls, ['glossary key kira-project', 'decisions key kira-project']);
});

test('glossary edits and stale-aware Undo use the same key-bearing seam', async () => {
  const calls: string[] = [];
  const entry: GlossaryEntry = {
    id: 'term-1',
    projectId: project.id,
    term: 'ticket',
    meaning: 'a bounded unit of work',
    wordsToAvoid: [],
    version: 2,
    author: { id: 'ada', name: 'Ada Lovelace' },
    chatId: 'chat-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    history: [],
  };
  const held = tracker(calls, {
    updateGlossary: async (key, projectId, edit: GlossaryEdit) => {
      calls.push(`updateGlossary ${key} ${projectId} ${edit.term} ${edit.chatId}`);
      return { kind: 'ok', body: entry };
    },
    undoGlossary: async (key, projectId, entryId, version, chatId) => {
      calls.push(`undoGlossary ${key} ${projectId} ${entryId} ${version} ${chatId}`);
      return { kind: 'refused', message: 'That glossary change is no longer current.' };
    },
  });

  assert.deepEqual(
    await held.held.updateGlossary?.(workspace.id, {
      term: 'ticket',
      meaning: 'a bounded unit of work',
      wordsToAvoid: [],
      chatId: 'chat-1',
    }),
    entry,
  );
  if (held.held.undoGlossary === undefined) throw new Error('Undo is unavailable.');
  await assert.rejects(held.held.undoGlossary(workspace.id, entry.id, entry.version, 'chat-1'), {
    message: 'That glossary change is no longer current.',
  });
  assert.deepEqual(calls, [
    'updateGlossary key kira-project ticket chat-1',
    'undoGlossary key kira-project term-1 2 chat-1',
  ]);
});

test('a folder that works no project is answered as itself, not with an empty queue', async () => {
  const calls: string[] = [];
  const held = tracker(calls);

  // The one failure the server cannot answer for: which project a folder works is
  // this machine's own fact, and a folder that works none is not a folder whose
  // project has no work in it.
  assert.equal(await tried(() => held.held.queue('some-other-folder')), `refused ${NO_PROJECT}`);
  assert.deepEqual(calls, []);
});

test('nobody signed in is said in its own words, and no request is made', async () => {
  const calls: string[] = [];
  const held = tracker(calls, {}, null);

  for (const act of [
    () => held.held.queue(workspace.id),
    () => held.held.write(workspace.id, draft),
    () => held.held.change(ticket.id, { title: 'x' }),
    () => held.held.gate(ticket.id, 'FND-2'),
    () => held.held.ungate(ticket.id, 'FND-2'),
    () => held.held.projects(),
    () => held.held.join(workspace.id, { kind: 'existing', projectId: project.id }),
  ]) {
    assert.equal(await tried(act), `refused ${NOBODY_SIGNED_IN}`);
  }

  assert.deepEqual(calls, []);
});

test('a server that cannot be reached is told apart from a refusal', async () => {
  const calls: string[] = [];
  const away: Partial<TrackerWire> = {
    queue: async () => ({ kind: 'unavailable' }),
    changeTicket: async () => ({ kind: 'unavailable' }),
  };
  const held = tracker(calls, away);

  // Nothing was said about the request: the server could not be asked, which is not
  // the same as being told no — one is worth trying again and the other is not.
  assert.equal(await tried(() => held.held.queue(workspace.id)), `refused ${UNREACHABLE}`);
  assert.equal(
    await tried(() => held.held.change(ticket.id, { title: 'x' })),
    `refused ${UNREACHABLE}`,
  );
});

test('a key the server has stopped honouring is said as nobody being signed in', async () => {
  const calls: string[] = [];
  const held = tracker(calls, { queue: async () => ({ kind: 'signed-out' }) });

  assert.equal(await tried(() => held.held.queue(workspace.id)), `refused ${NOBODY_SIGNED_IN}`);
});

test('a refusal is passed on in the server’s own words', async () => {
  const calls: string[] = [];
  const held = tracker(calls, {
    changeTicket: async () => ({
      kind: 'refused',
      message: 'Say how we’ll know this ticket is done before an agent starts on it.',
    }),
  });

  assert.equal(
    await tried(() => held.held.change(ticket.id, { status: 'running' })),
    'refused Say how we’ll know this ticket is done before an agent starts on it.',
  );
});

test('joining a project the server holds asks it for nothing', async () => {
  const calls: string[] = [];
  const held = tracker(calls);

  assert.deepEqual(
    await held.held.join(workspace.id, { kind: 'existing', projectId: project.id }),
    { ...workspace, projectId: project.id },
  );
  assert.deepEqual(held.joined, [{ ...workspace, projectId: project.id }]);
  assert.deepEqual(calls, []);
});

test('starting a project makes it on the server, then remembers it with the folder', async () => {
  const calls: string[] = [];
  const held = tracker(calls);

  assert.deepEqual(
    await held.held.join(workspace.id, { kind: 'new', name: 'Kira', prefix: 'FND' }),
    { ...workspace, projectId: project.id },
  );
  assert.deepEqual(calls, ['createProject key Kira FND']);
});

test('a prefix another project holds is refused, and the folder is left as it was', async () => {
  const calls: string[] = [];
  const held = tracker(calls, {
    createProject: async () => ({
      kind: 'refused',
      message: 'Another project already holds FND.',
    }),
  });

  assert.equal(
    await tried(() => held.held.join(workspace.id, { kind: 'new', name: 'Kira', prefix: 'FND' })),
    'refused Another project already holds FND.',
  );

  // Half-joined is worse than not joined: the folder keeps working no project.
  assert.deepEqual(held.joined, []);
});

test('joining a folder that is no longer open says so rather than failing oddly', async () => {
  const calls: string[] = [];
  const held = tracker(calls);

  assert.equal(
    await tried(() => held.held.join('gone', { kind: 'existing', projectId: project.id })),
    'refused That folder is no longer open.',
  );
});

test('a ticket is written into the project the folder works', async () => {
  const calls: string[] = [];
  const held = tracker(calls);

  assert.deepEqual(await held.held.write(workspace.id, draft), ticket);
  assert.deepEqual(calls, ['writeTicket key kira-project A ticket']);
});

test('a gate is named by whatever a person would say', async () => {
  const calls: string[] = [];
  const held = tracker(calls);

  await held.held.gate(ticket.id, 'FND-2');
  await held.held.ungate(ticket.id, 'FND-2');

  assert.deepEqual(calls, ['gateTicket key ticket-1 FND-2', 'ungateTicket key ticket-1 FND-2']);
});

test('the projects a folder could join are read with the key', async () => {
  const calls: string[] = [];
  const held = tracker(calls);

  assert.deepEqual(await held.held.projects(), [project]);
  assert.deepEqual(calls, ['projects key']);
});

test('question chats and Outcomes use the key-bearing person boundary', async () => {
  const calls: string[] = [];
  const held = tracker(calls, {
    openQuestion: async (key, ticketId, chatId) => {
      calls.push(`openQuestion ${key} ${ticketId} ${chatId}`);
      return {
        kind: 'ok',
        body: { ...ticket, kind: 'question', sourceChatId: chatId, status: 'needs-review' },
      };
    },
    approveOutcome: async (key, ticketId, value) => {
      calls.push(`approveOutcome ${key} ${ticketId} ${value.sourceChatId}`);
      return {
        kind: 'ok',
        body: {
          id: 'outcome-1',
          ticketId,
          answer: value.answer,
          sources: value.sources,
          decisionProposal: null,
          author: null,
          sourceChatId: value.sourceChatId,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      };
    },
  });

  assert.equal(
    (await held.held.openQuestion(workspace.id, ticket.id, 'chat-1')).sourceChatId,
    'chat-1',
  );
  assert.equal(
    (
      await held.held.approveOutcome(workspace.id, ticket.id, {
        answer: 'The answer.',
        sources: ['https://example.com'],
        sourceChatId: 'chat-1',
      })
    ).answer,
    'The answer.',
  );
  assert.deepEqual(calls, [
    'openQuestion key ticket-1 chat-1',
    'approveOutcome key ticket-1 chat-1',
  ]);
});
