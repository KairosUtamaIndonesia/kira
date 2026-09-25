import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Clock,
  FileText,
  Loader,
  Play,
} from 'lucide-react';
import type { Ticket, TicketRun } from '../../preload/bridge.ts';
import {
  bandIcon,
  branchNote,
  byName,
  firstIn,
  holding,
  howItWent,
  howLong,
  inBand,
  isUnbrokenSpec,
  runChoiceLabel,
  runTelling,
  saidByLabel,
  suggestPrefix,
  when,
  whyWaiting,
} from './workRows.ts';

/**
 * What a row is drawn from, which is the part of the Work surface that can be
 * wrong without anybody noticing: an icon that disagrees with the sentence beside
 * it, a parent that counts its closed children wrong, or a prefix the server
 * would refuse.
 */
function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'one',
    projectId: 'project',
    name: 'FND-1',
    number: 1,
    kind: 'feature',
    title: 'A ticket',
    body: '',
    criteria: [],
    gate: 'draft',
    band: 'draft',
    rank: 1,
    branch: 'fnd-1-a-ticket',
    author: null,
    gates: [],
    children: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    closedAt: null,
    closure: null,
    claim: null,
    runs: [],
    ...overrides,
  };
}

const child = (closed: boolean, closure: 'done' | 'wontfix' | null = null) => ({
  id: `child-${closed}-${closure}`,
  name: 'FND-2',
  closed,
  closure,
});

test('only a childless spec is waiting to be broken into tickets', () => {
  const cases = [
    { name: 'a blocked spec with no children', held: ticket({ kind: 'spec', band: 'blocked' }), want: true },
    { name: 'a spec with children', held: ticket({ kind: 'spec', children: [child(false)] }), want: false },
    { name: 'an empty feature ticket', held: ticket({ kind: 'feature', band: 'blocked' }), want: false },
  ];

  for (const testCase of cases) {
    assert.equal(isUnbrokenSpec(testCase.held), testCase.want, testCase.name);
  }
});

test('a band is drawn with the icon its state calls for', () => {
  const cases: { name: string; held: Ticket; want: unknown }[] = [
    { name: 'a draft', held: ticket(), want: FileText },
    { name: 'ready', held: ticket({ gate: 'ready-for-agent', band: 'ready' }), want: Play },
    { name: 'blocked', held: ticket({ gate: 'ready-for-agent', band: 'blocked' }), want: Clock },
    {
      name: 'closed as done',
      held: ticket({ band: 'done', closedAt: '2026-01-02T00:00:00.000Z', closure: 'done' }),
      want: CircleCheck,
    },
    {
      name: 'closed without being done',
      held: ticket({ band: 'done', closedAt: '2026-01-02T00:00:00.000Z', closure: 'wontfix' }),
      want: CircleAlert,
    },
  ];

  for (const testCase of cases) {
    assert.equal(bandIcon(testCase.held), testCase.want, testCase.name);
  }
});

test('a row says one thing, and its icon agrees with it', () => {
  const cases: { name: string; held: Ticket; words: string; icon: unknown }[] = [
    {
      name: 'a draft nobody has asked for',
      held: ticket(),
      words: 'draft',
      icon: CircleDashed,
    },
    {
      name: 'a ticket an agent may run',
      held: ticket({ gate: 'ready-for-agent', band: 'ready' }),
      words: 'ready for an agent',
      icon: Play,
    },
    {
      name: 'a ticket a person may pick up',
      held: ticket({ gate: 'ready-for-human', band: 'ready' }),
      words: 'ready for a person',
      icon: Play,
    },
    {
      name: 'a parent with nothing closed',
      held: ticket({
        gate: 'ready-for-agent',
        band: 'blocked',
        children: [child(false), child(false), child(false)],
      }),
      words: '0 of 3 closed',
      icon: Clock,
    },
    {
      name: 'a parent with one of three closed',
      held: ticket({
        gate: 'ready-for-agent',
        band: 'blocked',
        children: [child(true, 'done'), child(false), child(false)],
      }),
      words: '1 of 3 closed',
      icon: Clock,
    },
    {
      name: 'a parent whose last child closed',
      held: ticket({
        gate: 'ready-for-agent',
        band: 'ready',
        children: [child(true, 'done')],
      }),
      words: 'ready for an agent',
      icon: Play,
    },
    {
      name: 'a parent released by a slice nobody will do',
      held: ticket({
        gate: 'ready-for-agent',
        band: 'ready',
        children: [child(true, 'wontfix')],
      }),
      words: 'ready for an agent',
      icon: Play,
    },
    {
      name: 'a ticket closed as done',
      held: ticket({ band: 'done', closedAt: '2026-01-02T00:00:00.000Z', closure: 'done' }),
      words: 'done',
      icon: CircleCheck,
    },
    {
      name: 'a ticket closed without being done',
      held: ticket({ band: 'done', closedAt: '2026-01-02T00:00:00.000Z', closure: 'wontfix' }),
      words: 'closed without being done',
      icon: CircleAlert,
    },
  ];

  for (const testCase of cases) {
    const held = holding(testCase.held);

    assert.equal(held.words, testCase.words, `${testCase.name}: words`);
    assert.equal(held.icon, testCase.icon, `${testCase.name}: icon`);
  }
});

test('a band holds its own tickets, in the order it was given them', () => {
  const held = [
    ticket({ id: 'a', band: 'ready', gate: 'ready-for-agent', rank: 1 }),
    ticket({ id: 'b', band: 'draft', rank: 2 }),
    ticket({ id: 'c', band: 'ready', gate: 'ready-for-human', rank: 3 }),
  ];

  assert.deepEqual(
    inBand(held, 'ready').map((each) => each.id),
    ['a', 'c'],
  );
  assert.deepEqual(
    inBand(held, 'draft').map((each) => each.id),
    ['b'],
  );
  assert.deepEqual(inBand(held, 'done'), []);
});

test('the ticket a band opens on is the first one it holds', () => {
  const held = [
    ticket({ id: 'a', band: 'draft' }),
    ticket({ id: 'b', band: 'ready', gate: 'ready-for-agent' }),
  ];

  assert.equal(firstIn(held, 'all')?.id, 'a');
  assert.equal(firstIn(held, 'ready')?.id, 'b');
  assert.equal(firstIn(held, 'done'), undefined);
  assert.equal(firstIn([], 'all'), undefined);
});

test('when something happened is said in the unit that reads best', () => {
  const now = Date.parse('2026-03-01T12:00:00.000Z');
  const cases: { name: string; at: string; want: string }[] = [
    { name: 'this minute', at: '2026-03-01T12:00:00.000Z', want: 'just now' },
    { name: 'half a minute ago', at: '2026-03-01T11:59:30.000Z', want: 'just now' },
    { name: 'one minute ago', at: '2026-03-01T11:59:00.000Z', want: '1 minute ago' },
    { name: 'twelve minutes ago', at: '2026-03-01T11:48:00.000Z', want: '12 minutes ago' },
    { name: 'one hour ago', at: '2026-03-01T11:00:00.000Z', want: '1 hour ago' },
    { name: 'five hours ago', at: '2026-03-01T07:00:00.000Z', want: '5 hours ago' },
  ];

  for (const testCase of cases) {
    assert.equal(when(testCase.at, now), testCase.want, testCase.name);
  }

  // Older than a day is a date rather than a count of hours, which is the point at
  // which "37 hours ago" stops being easier to read than the day itself.
  assert.match(when('2026-02-20T12:00:00.000Z', now), /\d/);
});

test('a ticket is opened by saying its name, however it is said', () => {
  const held = [
    ticket({ id: 'a', name: 'FND-1' }),
    ticket({ id: 'b', name: 'FND-12' }),
    ticket({ id: 'c', name: 'KIRA-3' }),
  ];

  const cases: { name: string; said: string; want: string | undefined }[] = [
    { name: 'the name as the project writes it', said: 'FND-12', want: 'b' },
    { name: 'the name in another case', said: 'fnd-12', want: 'b' },
    { name: 'the name with space around it', said: '  FND-1  ', want: 'a' },
    { name: 'a name from another project', said: 'OTHER-1', want: undefined },
    { name: 'a number nobody wrote', said: 'FND-99', want: undefined },
    { name: 'nothing said at all', said: '', want: undefined },
    { name: 'only space', said: '   ', want: undefined },
    { name: 'something that is not a name', said: 'the queue', want: undefined },
  ];

  for (const testCase of cases) {
    assert.equal(byName(held, testCase.said)?.id, testCase.want, testCase.name);
  }
});

test('a name is matched whole, not as the start of one', () => {
  // `FND-1` is a real ticket and `FND-12` is another, so a lookup that matched a
  // prefix would open the wrong one rather than saying it found nothing.
  const held = [ticket({ id: 'long', name: 'FND-12' })];

  assert.equal(byName(held, 'FND-1'), undefined);
  assert.equal(byName(held, 'FND-12')?.id, 'long');
});

test('a prefix is suggested from the folder, and is always one the server takes', () => {
  const cases: { name: string; folder: string; want: string }[] = [
    { name: 'a plain name', folder: 'kira', want: 'KIRA' },
    { name: 'a name with a dash', folder: 'my-project', want: 'MYPROJ' },
    { name: 'a name with a space', folder: 'Kira Desktop', want: 'FOUNDR' },
    { name: 'a name that starts with a digit', folder: '123', want: 'F123' },
    { name: 'a name with nothing usable in it', folder: '—', want: 'PROJ' },
    { name: 'an empty name', folder: '', want: 'PROJ' },
    { name: 'a one-letter name', folder: 'a', want: 'AX' },
    { name: 'a name longer than a prefix may be', folder: 'abcdefghij', want: 'ABCDEF' },
  ];

  for (const testCase of cases) {
    const held = suggestPrefix(testCase.folder);

    assert.equal(held, testCase.want, testCase.name);
    // Whatever it suggests, the server takes it: two to six, starting with a letter.
    assert.match(held, /^[A-Z][A-Z0-9]{1,5}$/, testCase.name);
  }
});

test('a ticket somebody is working says who, and how long they have had it', () => {
  const now = new Date('2026-01-01T01:00:00.000Z').getTime();
  const claim = {
    holder: { id: 'ada', name: 'Ada Lovelace' },
    workerId: 'desk-1',
    startedAt: '2026-01-01T00:42:00.000Z',
    heardAt: '2026-01-01T00:59:00.000Z',
    leaseUntil: '2026-01-01T01:01:00.000Z',
    stale: false,
    quietMs: 60_000,
  };

  assert.deepEqual(holding(ticket({ band: 'running', claim }), now), {
    icon: Loader,
    words: 'held by Ada Lovelace for 18 minutes',
  });
});

test('a claim whose machine stopped answering reads as gone quiet, and can be taken over', () => {
  const claim = {
    holder: { id: 'ada', name: 'Ada Lovelace' },
    workerId: 'desk-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    heardAt: null,
    leaseUntil: '2026-01-01T00:01:00.000Z',
    stale: true,
    quietMs: 3_600_000,
  };
  const held = ticket({ band: 'running', claim });

  // The difference between a run being worked and one whose machine went away is the
  // whole of what a person needs to decide whether to step in, so it is the row's words.
  assert.deepEqual(holding(held), { icon: CircleAlert, words: 'held by Ada Lovelace, gone quiet' });
  assert.equal(bandIcon(held), Loader);
});

test('a ticket waiting on a person says why, in the run’s own words', () => {
  const run = {
    id: 'run-1',
    ticketId: 'one',
    workerId: 'desk-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:30:00.000Z',
    branch: 'fnd-1-a-ticket',
    stoppedBecause: 'It needs somebody to choose between the two helpers.',
    changed: '2 files changed',
    checks: ['bun test'],
    made: null,
    verdict: null,
  };

  assert.deepEqual(holding(ticket({ band: 'needs-you', runs: [run] })), {
    icon: CircleHelp,
    words: 'It needs somebody to choose between the two helpers.',
  });
  assert.equal(whyWaiting(ticket({ band: 'needs-you', runs: [run] })), run.stoppedBecause);
  assert.equal(
    whyWaiting(ticket({ band: 'needs-you', runs: [{ ...run, stoppedBecause: null }] })),
    'a proposal nobody has answered',
  );
});

test('how long a claim has been held is read as an age, not as a time', () => {
  const now = new Date('2026-01-02T12:00:00.000Z').getTime();

  assert.equal(howLong('2026-01-02T11:59:40.000Z', now), 'for a moment');
  assert.equal(howLong('2026-01-02T11:59:00.000Z', now), 'for 1 minute');
  assert.equal(
    howLong('2026-01-02T11:00:00.000Z', now),
    'for an hour'.replace('an hour', '1 hour'),
  );
  assert.equal(howLong('2026-01-01T12:00:00.000Z', now), 'for days');
});

const NOW = new Date('2026-01-01T01:00:00.000Z').getTime();

/** A run, as the ticket carries it. */
function run(overrides: Partial<TicketRun> = {}): TicketRun {
  return {
    id: 'run-one',
    ticketId: 'one',
    workerId: 'desk-1',
    startedAt: '2026-01-01T00:30:00.000Z',
    endedAt: '2026-01-01T00:40:00.000Z',
    branch: 'fnd-1-a-ticket',
    stoppedBecause: null,
    changed: '1 file changed, 2 insertions(+)',
    checks: ['bun test'],
    made: 'It is done.',
    verdict: null,
    ...overrides,
  };
}

test('a run says whether it is going, and what became of it when it stopped', () => {
  assert.equal(runTelling(run({ endedAt: null }), NOW), 'started 30 minutes ago · still going');
  assert.equal(runTelling(run(), NOW), 'ended 20 minutes ago · waiting for you');
  assert.equal(runTelling(run({ verdict: 'accepted' }), NOW), 'ended 20 minutes ago · accepted');
  assert.equal(runTelling(run({ verdict: 'sent-back' }), NOW), 'ended 20 minutes ago · sent back');
});

test('a run that stopped needing a person says why, in its own words', () => {
  const stopped = run({ stoppedBecause: 'The checkout is gone.' });

  assert.equal(runTelling(stopped, NOW), 'ended 20 minutes ago · stopped: The checkout is gone.');
  // A reason is what a person is waiting on, so it is said even after a verdict: the run
  // that stopped and was then answered still stopped.
  assert.match(
    runTelling(run({ stoppedBecause: 'It ran out of room.', verdict: 'sent-back' }), NOW),
    /sent back/,
  );
});

test('a run says in a word how it went, for a list that already says when', () => {
  assert.equal(howItWent(run({ endedAt: null })), 'still going');
  assert.equal(howItWent(run()), 'waiting for you');
  assert.equal(howItWent(run({ verdict: 'accepted' })), 'accepted');
  assert.equal(howItWent(run({ verdict: 'sent-back' })), 'sent back');
  assert.equal(howItWent(run({ stoppedBecause: 'The checkout is gone.' })), 'stopped');
});

test('a ticket that ran several times lists runs a person can tell apart', () => {
  const morning = run({ id: 'run-one', startedAt: new Date(2026, 8, 22, 9, 15).toISOString() });
  const evening = run({ id: 'run-two', startedAt: new Date(2026, 8, 22, 18, 40).toISOString() });

  // Two runs of one day would read identically if the list said "9 hours ago", which is
  // exactly what a ticket run twice in a day looks like.
  assert.notEqual(runChoiceLabel(morning), runChoiceLabel(evening));
  assert.match(runChoiceLabel(evening), /22.*18:40 · waiting for you$/);
  assert.equal(runChoiceLabel(run({ endedAt: null })).endsWith('still going'), true);
});

test('a line in a run is drawn by who said it, not by name', () => {
  assert.equal(saidByLabel('person'), 'you');
  assert.equal(saidByLabel('agent'), 'Kira');
  assert.equal(saidByLabel('note'), 'Kira');
});

test('the line a run opens with is drawn as the brief it was given, not as a person', () => {
  // Kira writes the run's opening itself, so the same speaker is drawn differently in
  // the one place where nobody spoke.
  assert.equal(saidByLabel('person', true), 'the brief it started from');
  assert.equal(saidByLabel('person', false), 'you');
  // And it is only the opening: an agent line first in a list is still the agent.
  assert.equal(saidByLabel('agent', true), 'Kira');
  assert.equal(saidByLabel('note', true), 'Kira');
});

test('the branch line knows whether a run has made the branch yet', () => {
  const derived = ticket({ branch: 'fnd-1-a-ticket' });
  assert.match(branchNote(derived), /^What a branch for this ticket would be called/);

  // The run made it: the ticket answers with the branch the run recorded, so the line
  // stops calling it a suggestion.
  const worked = ticket({ branch: 'fnd-1-a-ticket', runs: [run()] });
  assert.match(branchNote(worked), /^The branch a run made/);

  // A run that made some other branch — the ticket was retitled and the branch kept its
  // name, or the run was on an older branch — does not claim this one.
  const other = ticket({
    branch: 'fnd-1-a-ticket',
    runs: [run({ branch: 'fnd-1-something-else' })],
  });
  assert.match(branchNote(other), /^What a branch for this ticket would be called/);
});
