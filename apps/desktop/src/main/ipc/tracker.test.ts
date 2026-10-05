import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  TICKET_KINDS,
  type LivePullRequestDetail,
  type ProjectSkill,
  type Repository,
  type Ticket,
  type TicketComment,
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
  projectId: 'kira-project',
  name: 'FND-1',
  number: 1,
  kind: 'feature',
  title: 'Add acceptance criteria',
  body: 'A ticket says how it is known to be done.',
  criteria: ['A criterion is one line'],
  status: 'draft',
  blocked: false,
  rank: 1,
  priority: 'none',
  pullRequestUrl: null,
  assignee: { id: 'ada', name: 'Ada Lovelace' },
  tags: [],
  author: { id: 'ada', name: 'Ada Lovelace' },
  gates: [],
  children: [],
  parent: null,
  subIssues: [],
  relationships: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const queue: TicketQueue = {
  project: { id: 'kira-project', name: 'Kira', prefix: 'FND' },
  tickets: [ticket],
  counts: { draft: 1, ready: 0, running: 0, 'needs-review': 0, done: 0, 'wont-do': 0 },
};

const draft: TicketDraft = {
  kind: 'feature',
  title: 'Add acceptance criteria',
  body: 'A ticket says how it is known to be done.',
  criteria: ['A criterion is one line'],
};

const comment: TicketComment = {
  id: 'comment-1',
  ticketId: ticket.id,
  parentId: null,
  author: { id: 'ada', name: 'Ada Lovelace' },
  authorKind: 'member',
  body: 'A comment says something.',
  deleted: false,
  mine: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const repository: Repository = {
  id: 'repo-1',
  projectId: 'kira-project',
  provider: 'github',
  owner: 'acme',
  name: 'api',
  defaultBranch: 'main',
};

const liveDetail: LivePullRequestDetail = {
  number: 12,
  title: 'Fix it',
  body: '',
  authorLogin: null,
  state: 'open',
  url: 'https://github.com/acme/api/pull/12',
  base: 'main',
  head: 'fnd-12',
  checks: [],
  comments: [],
  files: [],
};

const skill: ProjectSkill = {
  id: 'skill-1',
  projectId: 'kira-project',
  name: 'review-checklist',
  description: 'What every review must check.',
  body: '# Review\n',
  files: [],
  author: null,
  chatId: null,
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
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
    timeline: async (ticketId, limit) => {
      calls.push(`timeline ${ticketId} ${limit ?? ''}`);
      return [];
    },
    comment: async (ticketId, body, parentId, authorKind) => {
      calls.push(`comment ${ticketId} ${body} ${parentId ?? ''} ${authorKind ?? ''}`);
      return comment;
    },
    editComment: async (commentId, body) => {
      calls.push(`editComment ${commentId} ${body}`);
      return { ...comment, body };
    },
    deleteComment: async (commentId) => {
      calls.push(`deleteComment ${commentId}`);
      return null;
    },
    repositories: async (projectId) => {
      calls.push(`repositories ${projectId}`);
      return [repository];
    },
    pullRequests: async (ticketId) => {
      calls.push(`pullRequests ${ticketId}`);
      return [];
    },
    checkoutPullRequests: async (chatId) => {
      calls.push(`checkoutPullRequests ${chatId}`);
      return [];
    },
    checkoutPullRequest: async (chatId, number) => {
      calls.push(`checkoutPullRequest ${chatId} ${number}`);
      return liveDetail;
    },
    attachRepository: async (projectId, input) => {
      calls.push(`attachRepository ${projectId} ${input.owner}/${input.name}`);
      return repository;
    },
    detachRepository: async (projectId, id) => {
      calls.push(`detachRepository ${projectId} ${id}`);
      return null;
    },
    skills: async (projectId) => {
      calls.push(`skills ${projectId}`);
      return [skill];
    },
    writeSkill: async (projectId, draft) => {
      calls.push(`writeSkill ${projectId} ${draft.name}`);
      return { ...skill, ...draft, chatId: null, files: [] };
    },
    changeSkill: async (projectId, skillId, change) => {
      calls.push(`changeSkill ${projectId} ${skillId} ${JSON.stringify(change)}`);
      return skill;
    },
    removeSkill: async (projectId, skillId) => {
      calls.push(`removeSkill ${projectId} ${skillId}`);
      return null;
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
          throw new Error('Say how we’ll know this ticket is done before an agent starts on it.');
        },
      }),
    call: 'write',
    args: ['api', draft],
    want: {
      ok: false,
      error: 'Say how we’ll know this ticket is done before an agent starts on it.',
    },
    wantCalls: [],
  },
  {
    name: 'change writes what was asked about a ticket',
    makeDeps: (calls) => deps(calls),
    call: 'change',
    args: ['ticket-1', { title: 'A better name', status: 'ready', rank: 0 }],
    want: { ok: true, value: ticket },
    wantCalls: ['change ticket-1 {"title":"A better name","status":"ready","rank":0}'],
  },
  {
    name: 'change takes a stored status',
    makeDeps: (calls) => deps(calls),
    call: 'change',
    args: ['ticket-1', { status: 'wont-do' }],
    want: { ok: true, value: ticket },
    wantCalls: ['change ticket-1 {"status":"wont-do"}'],
  },
  {
    name: 'change attaches or clears a secure pull request URL',
    makeDeps: (calls) => deps(calls),
    call: 'change',
    args: ['ticket-1', { pullRequestUrl: 'https://github.com/example/kira/pull/42' }],
    want: { ok: true, value: ticket },
    wantCalls: ['change ticket-1 {"pullRequestUrl":"https://github.com/example/kira/pull/42"}'],
  },
  {
    name: 'change can clear its pull request URL',
    makeDeps: (calls) => deps(calls),
    call: 'change',
    args: ['ticket-1', { pullRequestUrl: null }],
    want: { ok: true, value: ticket },
    wantCalls: ['change ticket-1 {"pullRequestUrl":null}'],
  },
  {
    name: 'change refuses an unsafe pull request URL',
    makeDeps: (calls) => deps(calls, { change: async () => assert.fail('a ticket was changed') }),
    call: 'change',
    args: ['ticket-1', { pullRequestUrl: 'javascript:alert(1)' }],
    want: { ok: false, error: 'That is not a change to a ticket.' },
    wantCalls: [],
  },
  {
    name: 'change refuses a status the tracker does not know',
    makeDeps: (calls) => deps(calls, { change: async () => assert.fail('a ticket was changed') }),
    call: 'change',
    args: ['ticket-1', { status: 'waiting' }],
    want: { ok: false, error: 'That is not a change to a ticket.' },
    wantCalls: [],
  },
  {
    name: 'change refuses a priority the tracker does not know',
    makeDeps: (calls) => deps(calls, { change: async () => assert.fail('a ticket was changed') }),
    call: 'change',
    args: ['ticket-1', { priority: 'critical' }],
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
          throw new Error(
            'Those two tickets would wait on each other. Choose a ticket that isn’t already blocked by this one.',
          );
        },
      }),
    call: 'gate',
    args: ['ticket-1', 'FND-2'],
    want: {
      ok: false,
      error:
        'Those two tickets would wait on each other. Choose a ticket that isn’t already blocked by this one.',
    },
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

test('timeline reads a ticket’s conversation and comment says something on it', async () => {
  const calls: string[] = [];
  const handlers = trackerHandlers(
    deps(calls, {
      timeline: async (ticketId, limit) => {
        calls.push(`timeline ${ticketId} ${limit ?? ''}`);
        return [];
      },
      comment: async (ticketId, body, parentId, authorKind) => {
        calls.push(`comment ${ticketId} ${body} ${parentId ?? ''} ${authorKind ?? ''}`);
        return comment;
      },
      editComment: async (commentId, body) => {
        calls.push(`editComment ${commentId} ${body}`);
        return { ...comment, body };
      },
      deleteComment: async (commentId) => {
        calls.push(`deleteComment ${commentId}`);
        return null;
      },
    }),
  );

  assert.deepEqual(await handlers.timeline('ticket-1', 50), { ok: true, value: [] });
  assert.deepEqual(await handlers.comment('ticket-1', 'Working on it.', undefined, 'kira'), {
    ok: true,
    value: comment,
  });
  assert.deepEqual(await handlers.editComment('comment-1', 'Changed'), {
    ok: true,
    value: { ...comment, body: 'Changed' },
  });
  assert.deepEqual(await handlers.deleteComment('comment-1'), { ok: true, value: null });
  assert.deepEqual(calls, [
    'timeline ticket-1 50',
    'comment ticket-1 Working on it.  kira',
    'editComment comment-1 Changed',
    'deleteComment comment-1',
  ]);

  assert.deepEqual(await handlers.timeline('', 50), {
    ok: false,
    error: 'A timeline is read for a ticket.',
  });
  assert.deepEqual(await handlers.timeline('ticket-1', 0), {
    ok: false,
    error: 'A timeline is read up to a whole number.',
  });
  assert.deepEqual(await handlers.comment('ticket-1', '   ', undefined, undefined), {
    ok: false,
    error: 'A comment says something.',
  });
  assert.deepEqual(await handlers.comment('ticket-1', 'Hi', '', undefined), {
    ok: false,
    error: 'A reply answers a comment.',
  });
  assert.deepEqual(await handlers.comment('ticket-1', 'Hi', undefined, 'robot'), {
    ok: false,
    error: 'That is not an author.',
  });
  assert.deepEqual(await handlers.editComment('', 'x'), {
    ok: false,
    error: 'A comment needs an id to be changed.',
  });
  assert.deepEqual(await handlers.deleteComment(''), {
    ok: false,
    error: 'A comment needs an id to be removed.',
  });
});

test('repositories reads, attaches, and detaches, with the host checked', async () => {
  const calls: string[] = [];
  const handlers = trackerHandlers(
    deps(calls, {
      repositories: async (projectId) => {
        calls.push(`repositories ${projectId}`);
        return [repository];
      },
      attachRepository: async (projectId, input) => {
        calls.push(
          `attachRepository ${projectId} ${input.owner}/${input.name}/${input.provider ?? ''}`,
        );
        return repository;
      },
      detachRepository: async (projectId, id) => {
        calls.push(`detachRepository ${projectId} ${id}`);
        return null;
      },
    }),
  );

  assert.deepEqual(await handlers.repositories('kira-project'), { ok: true, value: [repository] });
  assert.deepEqual(
    await handlers.attachRepository('kira-project', {
      owner: 'acme',
      name: 'api',
      provider: 'gitea',
    }),
    { ok: true, value: repository },
  );
  assert.deepEqual(await handlers.detachRepository('kira-project', 'repo-1'), {
    ok: true,
    value: null,
  });
  assert.deepEqual(await handlers.pullRequests('ticket-1'), { ok: true, value: [] });
  assert.deepEqual(calls, [
    'repositories kira-project',
    'attachRepository kira-project acme/api/gitea',
    'detachRepository kira-project repo-1',
    'pullRequests ticket-1',
  ]);

  assert.deepEqual(await handlers.repositories(''), {
    ok: false,
    error: 'Repositories are read for a project.',
  });
  assert.deepEqual(await handlers.attachRepository('kira-project', { owner: '', name: 'api' }), {
    ok: false,
    error: 'That is not a repository to attach.',
  });
  assert.deepEqual(
    await handlers.attachRepository('kira-project', {
      owner: 'acme',
      name: 'api',
      provider: 'bitbucket',
    }),
    { ok: false, error: 'That is not a repository to attach.' },
  );
  assert.deepEqual(await handlers.detachRepository('kira-project', ''), {
    ok: false,
    error: 'A repository needs an id to be removed.',
  });
  assert.deepEqual(await handlers.pullRequests(''), {
    ok: false,
    error: 'Pull requests are read for a ticket.',
  });
});

test('skills read, write, change and remove, with the shape checked', async () => {
  const calls: string[] = [];
  const handlers = trackerHandlers(deps(calls));

  assert.deepEqual(await handlers.skills('kira-project'), { ok: true, value: [skill] });
  assert.deepEqual(
    await handlers.writeSkill('kira-project', {
      name: 'style-check',
      description: 'How this project reviews style.',
      body: '# Style\n',
    }),
    {
      ok: true,
      value: {
        ...skill,
        name: 'style-check',
        description: 'How this project reviews style.',
        body: '# Style\n',
        chatId: null,
        files: [],
      },
    },
  );
  assert.deepEqual(await handlers.changeSkill('kira-project', 'skill-1', { body: '# New\n' }), {
    ok: true,
    value: skill,
  });
  assert.deepEqual(await handlers.removeSkill('kira-project', 'skill-1'), {
    ok: true,
    value: null,
  });
  assert.deepEqual(calls, [
    'skills kira-project',
    'writeSkill kira-project style-check',
    'changeSkill kira-project skill-1 {"body":"# New\\n"}',
    'removeSkill kira-project skill-1',
  ]);

  assert.deepEqual(await handlers.skills(''), {
    ok: false,
    error: 'Skills are read for a project.',
  });
  assert.deepEqual(
    await handlers.writeSkill('kira-project', { name: '', description: 'x', body: '' }),
    {
      ok: false,
      error: 'That is not a skill to write.',
    },
  );
  // A skill with no description does not load in pi at all, so it is not a skill
  // to write here either.
  assert.deepEqual(
    await handlers.writeSkill('kira-project', { name: 'style-check', description: '  ', body: '' }),
    { ok: false, error: 'That is not a skill to write.' },
  );
  assert.deepEqual(
    await handlers.writeSkill('kira-project', {
      name: 'style-check',
      description: 'x',
      body: '',
      files: [{ path: 7, content: '' }],
    }),
    { ok: false, error: 'That is not a skill to write.' },
  );
  assert.deepEqual(await handlers.changeSkill('kira-project', '', { body: 'x' }), {
    ok: false,
    error: 'A skill needs an id to be changed.',
  });
  assert.deepEqual(await handlers.changeSkill('kira-project', 'skill-1', { name: '  ' }), {
    ok: false,
    error: 'That is not a change to a skill.',
  });
  assert.deepEqual(await handlers.removeSkill('kira-project', ''), {
    ok: false,
    error: 'A skill needs an id to be removed.',
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

    assert.deepEqual(
      await (run as Record<string, (() => Promise<unknown>) | undefined>)[testCase.call]!(),
      testCase.want,
    );
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
