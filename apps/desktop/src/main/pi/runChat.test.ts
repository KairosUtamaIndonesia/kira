/**
 * The three judgements a run's chat makes, away from the chat itself.
 *
 * What a run is *told*, what of what it said is settled enough to keep, and which of the
 * commands it ran count as having run it — all three are pure, and all three are the sort
 * of thing that is quietly wrong for a week before anyone notices. So they are tested
 * here rather than through a real session: a fake transcript says exactly what these need
 * to be judged against, and nothing about a provider is involved.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatMessage, ChatTranscript, Ticket } from '../../preload/bridge.ts';
import { linesIn, MAP_RUN_REFUSAL, promptFor, ranIn } from './runChat.ts';
import type { RunContext } from '../tracker.ts';

const ticket: Ticket = {
  id: 'ticket-1',
  projectId: 'project-1',
  number: 3,
  name: 'FND-3',
  kind: 'feature',
  title: 'The queue survives a restart',
  body: 'It should be there when the app comes back.',
  criteria: ['The row is still there', 'Nothing is lost'],
  gate: 'ready-for-agent',
  band: 'ready',
  rank: 1,
  branch: 'fnd-3-the-queue-survives-a-restart',
  author: null,
  gates: [],
  children: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  closedAt: null,
  closure: null,
  claim: null,
  runs: [],
};

/** A transcript of one message per line given. */
function transcript(messages: ChatMessage[]): ChatTranscript {
  return { messages, trailing: [], headId: null };
}

function said(id: string, role: 'you' | 'kira', parts: ChatMessage['parts']): ChatMessage {
  return { id, parentId: null, role, parts };
}

function words(text: string) {
  return { type: 'text' as const, text };
}

/** A step that ran a command, which is all a run's checks are read from. */
function ran(name: string, target: string | null) {
  return {
    type: 'work' as const,
    reasoning: null,
    durationMs: 4,
    calls: [
      {
        name,
        target,
        status: 'complete' as const,
        durationMs: 4,
        output: null,
        additions: null,
        deletions: null,
      },
    ],
  };
}

test('a run is told the ticket’s own words, and the row it leaves is named for the ticket', () => {
  const told = promptFor(ticket, 'fnd-3-the-queue-survives-a-restart');

  // The first line is the ticket's name because a chat is named by the first thing a
  // person asked it: without this the run's row in the sidebar would be called after the
  // first line of a paragraph of instructions.
  assert.equal(told.split('\n')[0], 'FND-3 — The queue survives a restart');
  assert.match(told, /It should be there when the app comes back\./);
  // The criteria are the contract the run is working to, and they are bulleted because a
  // run that has to guess which lines are the criteria will guess wrong.
  assert.match(told, /- The row is still there\n- Nothing is lost/);
  assert.match(told, /fnd-3-the-queue-survives-a-restart/);
});

test('an integration run receives every child’s acceptance criteria and checks them together', () => {
  const context: RunContext = {
    spec: {
      id: 'spec-1',
      name: 'FND-1',
      title: 'Ship the queue',
      body: 'The spec request.',
      sourceChatId: null,
    },
    siblings: [
      {
        id: 'child-1',
        name: 'FND-2',
        title: 'Store it',
        kind: 'feature',
        band: 'done',
        criteria: ['It survives restart.'],
      },
      {
        id: 'child-2',
        name: 'FND-3',
        title: 'Show it',
        kind: 'feature',
        band: 'done',
        criteria: ['The row shows the current state.'],
      },
    ],
    glossary: [],
    decisions: [],
  };

  const told = promptFor({ ...ticket, kind: 'spec' }, 'spec-branch', context);
  assert.match(told, /FND-2 — Store it[\s\S]*It survives restart\./);
  assert.match(told, /FND-3 — Show it[\s\S]*The row shows the current state\./);
  assert.match(told, /check every child’s acceptance criteria together against the spec request/i);
});

test('a conflict-resolution run tells Kira to update the ticket branch before merging', () => {
  const told = promptFor(ticket, 'fnd-3-the-queue-survives-a-restart', 'shared.txt conflicts');

  assert.match(told, /conflict-resolution run/);
  assert.match(told, /Bring this ticket branch up to date/);
  assert.match(told, /shared\.txt conflicts/);
});

test('what proves a ticket done is asked by kind, not once for all of them', () => {
  const feature = promptFor(ticket, 'a-branch');
  const question = promptFor({ ...ticket, kind: 'question' }, 'a-branch');
  const bug = promptFor({ ...ticket, kind: 'bug' }, 'a-branch');

  assert.notEqual(feature, question);
  assert.notEqual(feature, bug);
  assert.match(question, /find the answer/);
  assert.match(bug, /the test that would have caught it/);
});

test('the opening brief carries current spec, siblings, project knowledge, and its skill', () => {
  const context: RunContext = {
    spec: {
      id: 'spec-1',
      name: 'FND-1',
      title: 'Ship the queue',
      body: 'The approved project plan.',
      sourceChatId: 'shape-chat',
    },
    siblings: [
      {
        id: 'sibling-1',
        name: 'FND-3',
        title: 'Test the slice',
        kind: 'bug',
        band: 'blocked',
        criteria: ['The test catches the reported failure.'],
      },
    ],
    glossary: [
      {
        id: 'term-1',
        projectId: 'project-1',
        term: 'slice',
        meaning: 'a vertical piece of work',
        wordsToAvoid: ['task'],
        version: 1,
        author: null,
        chatId: 'shape-chat',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        history: [],
      },
    ],
    decisions: [
      {
        id: 'decision-1',
        projectId: 'project-1',
        context: 'The queue needs durable history.',
        choice: 'Keep it in the tracker.',
        rejectedOptions: [],
        consequences: 'Runs can read it.',
        author: null,
        sourceChatId: 'shape-chat',
        supersededById: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
  const told = promptFor(ticket, 'a-branch', context);

  assert.match(told, /Enclosing spec: FND-1 — Ship the queue/);
  assert.match(told, /The approved project plan\./);
  assert.match(told, /- FND-3 — Test the slice \[bug; blocked\]/);
  assert.doesNotMatch(told, /The test catches the reported failure\./);
  assert.match(told, /- slice: a vertical piece of work \(avoid: task\)/);
  assert.match(
    told,
    /- Keep it in the tracker\. \(context: The queue needs durable history\.; rejected: none; consequences: Runs can read it\.\)/,
  );
  assert.match(told, /Required workflow skill: \/implement\./);
});

test('each runnable kind selects its bundled workflow skill', () => {
  const skills: [Ticket['kind'], string][] = [
    ['prototype', '/prototype'],
    ['bug', '/diagnosing-bugs'],
    ['feature', '/implement'],
    ['refactor', '/implement'],
    ['question', '/research'],
    ['research', '/research'],
    ['spec', '/to-spec'],
  ];

  for (const [kind, skill] of skills) {
    assert.match(
      promptFor({ ...ticket, kind }, 'a-branch'),
      new RegExp(`Required workflow skill: ${skill}\\.`),
    );
  }
});

test('maps are refused rather than given a fabricated run brief', () => {
  assert.throws(() => promptFor({ ...ticket, kind: 'map' }, 'a-branch'), {
    message: MAP_RUN_REFUSAL,
  });
});

test('a ticket with nothing written down says so rather than leaving a gap', () => {
  const told = promptFor({ ...ticket, body: '   ' }, 'a-branch');

  assert.match(told, /\(nothing was written down beyond the title\)/);
});

test('a person’s line is handed over at once, and an agent’s only when it has stopped', () => {
  const handed = new Set<string>();
  const held = transcript([
    said('m1', 'you', [words('Use the existing helper.')]),
    said('m2', 'kira', [words('Half a sen')]),
  ]);

  // Mid-reply: the person's words are complete and go now; the reply is a fragment and a
  // fragment kept on a ticket is worse than nothing.
  assert.deepEqual(linesIn(held, handed, true), [
    { saidBy: 'person', words: 'Use the existing helper.' },
  ]);

  // The same transcript with the reply finished: now it is worth keeping, and the person's
  // line is not written twice.
  const finished = transcript([
    said('m1', 'you', [words('Use the existing helper.')]),
    said('m2', 'kira', [words('Half a sentence. Then the rest of it.')]),
  ]);
  assert.deepEqual(linesIn(finished, handed, false), [
    { saidBy: 'agent', words: 'Half a sentence. Then the rest of it.' },
  ]);
});

test('a step that said nothing is taken and not handed over', () => {
  const handed = new Set<string>();

  assert.deepEqual(
    linesIn(transcript([said('m1', 'kira', [ran('bash', 'ls')])]), handed, false),
    [],
  );
  // The same set: nothing has to be taken twice for a message with no words in it to stay
  // taken, and a later message is still handed over.
  assert.deepEqual(linesIn(transcript([said('m2', 'kira', [words('Now.')])]), handed, false), [
    { saidBy: 'agent', words: 'Now.' },
  ]);
});

test('the commands a run ran are what its checks are, in the order it first ran them', () => {
  const held = transcript([
    said('m1', 'kira', [ran('bash', 'bun test'), ran('read', 'src/tickets.ts')]),
    said('m2', 'kira', [ran('bash', 'git status'), ran('bash', 'bun test')]),
    said('m3', 'kira', [ran('bash', null)]),
  ]);

  assert.deepEqual(ranIn(held), ['bun test', 'git status']);
});

test('a run that ran nothing has no checks rather than an empty one', () => {
  assert.deepEqual(
    ranIn(transcript([said('m1', 'kira', [words('I just thought about it.')])])),
    [],
  );
});
