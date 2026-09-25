/**
 * Pressing Run, and what becomes of the run.
 *
 * What matters here is the order of the calls and what is left behind when one of them
 * fails, so the stubs record what they were asked in sequence. The server's own rules — a
 * claim refused on a ticket that is not ready, a run started only on a claim — are its
 * tests' businesses; this file is about what this machine does with those answers, and
 * about the one thing a failed run must never do: take a ticket off the queue and leave
 * it there.
 *
 * The turn itself is faked rather than run: a chat that never finishes until the test says
 * so, because the interesting half of a run is what happens while it is still going — the
 * words landing on the ticket as they are said, and the row still being there.
 */
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Ticket, TicketRun, TicketSaid } from '../preload/bridge.ts';
import type { RunChat, RunLine } from './pi/runChat.ts';
import { runsFor, type Runs } from './runs.ts';
import type { TrackerAnswer, TrackerWire } from './tracker.ts';
import type { Worktrees } from './workspace/worktrees.ts';
import { tempDir } from './test-support/temp.ts';

const ticket: Ticket = {
  id: 'ticket-1',
  projectId: 'project-1',
  number: 1,
  name: 'FND-1',
  kind: 'feature',
  title: 'A ticket a run works on',
  body: '',
  criteria: ['It is known to be done'],
  gate: 'ready-for-agent',
  band: 'ready',
  rank: 1,
  branch: 'fnd-1-a-ticket-a-run-works-on',
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

const spec: Ticket = {
  ...ticket,
  id: 'spec-1',
  name: 'FND-2',
  number: 2,
  kind: 'spec',
  title: 'The enclosing spec',
  branch: 'fnd-2-the-enclosing-spec',
  children: [{ id: ticket.id, name: ticket.name, closed: false, closure: null }],
};

const slice: Ticket = {
  ...ticket,
  gates: [{ id: spec.id, name: spec.name, closed: false, closure: null }],
};

const run: TicketRun = {
  id: 'run-1',
  ticketId: 'ticket-1',
  workerId: 'desk-1',
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: null,
  branch: null,
  stoppedBecause: null,
  changed: null,
  checks: null,
  made: null,
  verdict: null,
};

const proposalRun: TicketRun = {
  ...run,
  endedAt: '2026-01-01T00:01:00.000Z',
  branch: ticket.branch,
};
const proposalSlice: Ticket = { ...slice, runs: [proposalRun] };

/** A ticket's own folder, made for the case and swept up after. */
function folderMade(): string {
  return tempDir('kira-run-folder-');
}

/** A wire that answers what one case needs and records everything it was asked. */
function wire(
  calls: string[],
  answers: Partial<TrackerWire> = {},
  refuseClaim?: string,
  refuseStart?: string,
  read: Ticket = ticket,
  queueTickets: Ticket[] = [],
) {
  const unused = async (): Promise<TrackerAnswer<never>> => {
    throw new Error('the runs keeper asked the tracker something it should not have');
  };

  const held: TrackerWire = {
    projects: unused,
    createProject: unused,
    queue: async (_key, projectId) => {
      calls.push(`queue ${projectId}`);
      return {
        kind: 'ok',
        body: {
          project: { id: projectId, name: 'Kira', prefix: 'FND' },
          tickets: queueTickets,
          counts: { draft: 0, ready: 0, blocked: 0, running: 0, 'needs-you': 0, done: 0 },
        },
      };
    },
    writeTicket: unused,
    changeTicket: unused,
    gateTicket: unused,
    ungateTicket: unused,
    readTicket: async (key, ref) => {
      calls.push(`read ${ref}`);
      return { kind: 'ok', body: read };
    },
    readTranscript: async (key, ticketId, runId) => {
      calls.push(`transcript of ${runId}`);
      return { kind: 'ok', body: [] };
    },
    takeOverTicket: async (key, ticketId) => {
      calls.push(`take over ${ticketId}`);
      return { kind: 'ok', body: ticket };
    },
    judgeRun: async (key, ticketId, runId, verdict) => {
      calls.push(`judge ${runId} ${verdict}`);
      return { kind: 'ok', body: run };
    },
    sayInRun: async (key, ticketId, runId, said) => {
      calls.push(`said ${said.saidBy}: ${said.words}`);
      return { kind: 'ok', body: { id: `said-${calls.length}`, at: 'now', ...said } };
    },
    claimTicket: async (key, ticketId, workerId) => {
      calls.push(`claim ${ticketId} as ${workerId} with ${key}`);
      if (refuseClaim !== undefined) return { kind: 'refused', message: refuseClaim };

      return { kind: 'ok', body: ticket };
    },
    releaseTicket: async (key, ticketId) => {
      calls.push(`release ${ticketId}`);
      return { kind: 'ok', body: {} };
    },
    startRun: async (key, ticketId, workerId) => {
      calls.push(`start ${ticketId} as ${workerId}`);
      if (refuseStart !== undefined) return { kind: 'refused', message: refuseStart };

      return { kind: 'ok', body: run };
    },
    recordRun: async (key, ticketId, runId, recorded) => {
      calls.push(`record ${runId} ${JSON.stringify(recorded)}`);
      return { kind: 'ok', body: run };
    },
    endRun: async (key, ticketId, runId, ending) => {
      calls.push(`end ${runId} ${JSON.stringify(ending)}`);
      return { kind: 'ok', body: run };
    },
    ...answers,
  };

  return held;
}

/** A worktrees seam that records what it made, measured and dropped. */
function worktrees(
  calls: string[],
  canMake = true,
  changed: string | null = '2 files changed',
  canPrepare = true,
  merge: 'merged' | 'conflict' | 'refused' = 'merged',
) {
  const made: { folder: string; branch: string; into: string }[] = [];
  const bases: (string | undefined)[] = [];
  const dropped: string[] = [];

  const held: Worktrees = {
    prepareSpec: async (_folder, branch) => (canPrepare ? branch : null),
    mergeSpec: async (_folder, specBranch, runBranch) => {
      calls.push(`merge ${runBranch} into ${specBranch}`);
      return merge === 'merged'
        ? { kind: 'merged' }
        : { kind: merge, reason: `the ${merge} was refused` };
    },
    make: async (folder, branch, into, from) => {
      calls.push(`worktree ${branch}`);
      made.push({ folder, branch, into });
      bases.push(from);

      return canMake ? into : null;
    },
    drop: async (_folder, into) => {
      calls.push(`drop ${into}`);
      dropped.push(into);
    },
    changed: async (_folder, into) => {
      calls.push(`changed in ${into}`);

      return changed;
    },
  };

  return { held, made, bases, dropped };
}

/** A chat for a run: it says what it is told to, and goes on until the test lets it end. */
function runChat(calls: string[], over: { ran?: string[]; fails?: string } = {}) {
  let listeners: ((line: RunLine) => void)[] = [];
  let finished: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });

  const chat: RunChat = {
    threadId: 'run-1',
    begin: async (branch, resolutionReason) => {
      calls.push(
        resolutionReason === undefined
          ? `begin on ${branch}`
          : `begin on ${branch} to resolve ${resolutionReason}`,
      );
      await done;
      if (over.fails !== undefined) throw new Error(over.fails);
    },
    onLine: (listener) => {
      listeners = [...listeners, listener];

      return () => {};
    },
    ran: () => over.ran ?? [],
    close: () => calls.push('close the chat'),
  };

  return {
    chat,
    /** Say something in it, as the person or the agent would. */
    says: (line: RunLine) => {
      for (const listener of listeners) listener(line);
    },
    /** Let the turn end, and wait for the keeper to have dealt with that. */
    ends: async () => {
      finished();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

/** The keeper over those stubs. */
function keeper(
  over: {
    folder?: string | undefined;
    affordable?: boolean;
    canMake?: boolean;
    refuseClaim?: string;
    refuseStart?: string;
    signedIn?: boolean;
    calls?: string[];
    ran?: string[];
    fails?: string;
    changed?: string | null;
    kind?: Ticket['kind'];
    canPrepare?: boolean;
    merge?: 'merged' | 'conflict' | 'refused';
    read?: Ticket;
    queue?: Ticket[];
  } = {},
) {
  const calls = over.calls ?? [];
  const wired = wire(
    calls,
    over.kind === 'map'
      ? {
          readTicket: async (_key, ref) => {
            calls.push(`read ${ref}`);
            return { kind: 'ok', body: { ...ticket, kind: 'map' } };
          },
        }
      : {},
    over.refuseClaim,
    over.refuseStart,
    over.read,
    over.queue,
  );
  const trees = worktrees(
    calls,
    over.canMake ?? true,
    over.changed,
    over.canPrepare ?? true,
    over.merge,
  );
  const chatting = runChat(calls, {
    ...(over.ran === undefined ? {} : { ran: over.ran }),
    ...(over.fails === undefined ? {} : { fails: over.fails }),
  });

  const runs: Runs = runsFor({
    token: async () => (over.signedIn === false ? null : 'key-1'),
    workerOf: async () => 'desk-1',
    folderOf: () => over.folder,
    thereFor: (ticketId) => `/runs/${ticketId}`,
    affordable: () => over.affordable ?? true,
    worktrees: trees.held,
    chatFor: async () => chatting.chat,
    wire: wired,
  });

  return { runs, calls, trees, chatting };
}

test('Run claims the ticket, starts a run, and sets a chat going in a checkout of its own', async () => {
  const folder = folderMade();
  const { runs, calls, trees } = keeper({ folder });

  const started = await runs.start('workspace-1', 'ticket-1');

  assert.equal(started.id, 'run-1');
  // The claim is taken by this desktop and against this key; the run is started on that
  // claim; the ticket is read from the server rather than taken from the window; and the
  // branch is recorded as soon as there is a checkout, which is what makes the ticket
  // answer with a branch that exists (GH #64).
  assert.deepEqual(calls, [
    'read ticket-1',
    'claim ticket-1 as desk-1 with key-1',
    'start ticket-1 as desk-1',
    'worktree fnd-1-a-ticket-a-run-works-on',
    'record run-1 {"branch":"fnd-1-a-ticket-a-run-works-on"}',
    'begin on fnd-1-a-ticket-a-run-works-on',
  ]);
  assert.deepEqual(trees.made, [
    { folder, branch: 'fnd-1-a-ticket-a-run-works-on', into: '/runs/ticket-1' },
  ]);
  assert.equal(runs.where('ticket-1'), '/runs/ticket-1');
  assert.deepEqual(runs.driving(), ['ticket-1']);
});

test('a slice starts from its enclosing spec branch', async () => {
  const { runs, calls, trees } = keeper({
    folder: folderMade(),
    read: slice,
    queue: [spec, slice],
  });

  await runs.start('workspace-1', 'ticket-1');

  assert.ok(calls.includes('queue project-1'));
  assert.equal(trees.bases[0], spec.branch);
});

test('a spec remote refusal happens before the ticket is claimed', async () => {
  const { runs, calls, trees } = keeper({
    folder: folderMade(),
    read: slice,
    queue: [spec, slice],
    canPrepare: false,
  });

  await assert.rejects(() => runs.start('workspace-1', 'ticket-1'), /configured remote/);
  assert.deepEqual(calls, ['read ticket-1', 'queue project-1']);
  assert.deepEqual(trees.made, []);
});

test('accepting a slice merges and pushes its branch before recording the verdict', async () => {
  const { runs, calls } = keeper({
    folder: folderMade(),
    read: proposalSlice,
    queue: [spec, proposalSlice],
  });

  // Retain the project folder as a completed run would: the checkout itself is gone, but
  // the enclosing project is where the shared spec branch is integrated.
  await runs.start('workspace-1', 'ticket-1');
  calls.length = 0;

  await runs.judge('ticket-1', 'run-1', 'accepted');

  assert.deepEqual(calls, [
    'read ticket-1',
    'queue project-1',
    'merge fnd-1-a-ticket-a-run-works-on into fnd-2-the-enclosing-spec',
    'judge run-1 accepted',
  ]);
});

test('accepting a ticket outside a spec keeps its existing branch behavior', async () => {
  const outside = { ...proposalSlice, gates: [], runs: [proposalRun] };
  const { runs, calls } = keeper({
    folder: folderMade(),
    read: outside,
    queue: [],
  });

  // The run's branch is still its own branch; only a ticket enclosed by a spec is
  // integrated into a shared branch.
  await runs.start('workspace-1', 'ticket-1');
  calls.length = 0;

  await runs.judge('ticket-1', 'run-1', 'accepted');

  assert.deepEqual(calls, ['read ticket-1', 'judge run-1 accepted']);
});

test('a merge conflict refuses acceptance without a verdict', async () => {
  const { runs, calls } = keeper({
    folder: folderMade(),
    read: proposalSlice,
    queue: [spec, proposalSlice],
    merge: 'conflict',
  });

  await runs.start('workspace-1', 'ticket-1');
  calls.length = 0;

  await assert.rejects(
    () => runs.judge('ticket-1', 'run-1', 'accepted'),
    /Merge conflict: the conflict was refused/,
  );
  assert.deepEqual(calls, [
    'read ticket-1',
    'queue project-1',
    'merge fnd-1-a-ticket-a-run-works-on into fnd-2-the-enclosing-spec',
  ]);
});

test('Resolve with Kira starts the same ticket with the conflict in its brief', async () => {
  const { runs, calls } = keeper({
    folder: folderMade(),
    read: proposalSlice,
    queue: [spec, proposalSlice],
  });

  await runs.resolve('workspace-1', 'ticket-1', 'conflicting files: src/app.ts');

  assert.deepEqual(calls.slice(-5), [
    'claim ticket-1 as desk-1 with key-1',
    'start ticket-1 as desk-1',
    'worktree fnd-1-a-ticket-a-run-works-on',
    'record run-1 {"branch":"fnd-1-a-ticket-a-run-works-on"}',
    'begin on fnd-1-a-ticket-a-run-works-on to resolve conflicting files: src/app.ts',
  ]);
});

test('what the run says lands on the ticket as it is said, without waiting for the end', async () => {
  const { runs, calls, chatting } = keeper({ folder: folderMade() });
  await runs.start('workspace-1', 'ticket-1');

  chatting.says({ saidBy: 'agent', words: 'Found the helper.' });
  chatting.says({ saidBy: 'person', words: 'Use it rather than a new one.' });

  // Written as it settles rather than at the end, because the end is the thing that might
  // not happen: an app that closed mid-run should leave the afternoon on the ticket.
  assert.deepEqual(calls.slice(6), [
    'said agent: Found the helper.',
    'said person: Use it rather than a new one.',
  ]);
});

test('a run that stops writing proposes what it changed and what it ran, and lets its checkout go', async () => {
  const { runs, calls, trees, chatting } = keeper({
    folder: folderMade(),
    ran: ['bun test', 'git status'],
  });
  await runs.start('workspace-1', 'ticket-1');
  chatting.says({ saidBy: 'agent', words: 'Added the helper and covered it.' });

  await chatting.ends();

  assert.deepEqual(calls.slice(6), [
    'said agent: Added the helper and covered it.',
    'changed in /runs/ticket-1',
    'end run-1 {"changed":"2 files changed","checks":["bun test","git status"],"made":"Added the helper and covered it."}',
    'close the chat',
    'drop /runs/ticket-1',
  ]);
  assert.deepEqual(trees.dropped, ['/runs/ticket-1']);
  assert.equal(runs.where('ticket-1'), null);
  assert.deepEqual(runs.driving(), []);
});

test('a run that changed nothing says so rather than proposing an empty line', async () => {
  const { runs, calls, chatting } = keeper({ folder: folderMade(), changed: null });
  await runs.start('workspace-1', 'ticket-1');

  await chatting.ends();

  assert.ok(calls.includes('end run-1 {"changed":"Nothing was changed."}'));
});

test('a turn that fell over ends the run saying so rather than leaving it claimed and silent', async () => {
  const { runs, calls, chatting } = keeper({
    folder: folderMade(),
    fails: 'the provider went away',
  });
  await runs.start('workspace-1', 'ticket-1');

  await chatting.ends();

  assert.deepEqual(calls.slice(6), [
    'end run-1 {"stoppedBecause":"The run stopped: the provider went away"}',
    'close the chat',
    'drop /runs/ticket-1',
  ]);
  assert.deepEqual(runs.driving(), []);
});

test('a map is refused before claim or start and keeps no run tail', async () => {
  const { runs, calls, trees } = keeper({ folder: folderMade(), kind: 'map' });

  await assert.rejects(
    () => runs.start('workspace-1', 'ticket-1'),
    /planning records and cannot be run/,
  );
  assert.deepEqual(calls, ['read ticket-1']);
  assert.deepEqual(trees.made, []);
  assert.equal(runs.where('ticket-1'), null);
});

test('a ticket that cannot be claimed is refused in the server’s own words, and nothing is started', async () => {
  const { runs, calls, trees } = keeper({
    folder: folderMade(),
    refuseClaim: 'A ticket an agent runs has to be ready first.',
  });

  await assert.rejects(
    () => runs.start('workspace-1', 'ticket-1'),
    /A ticket an agent runs has to be ready first\./,
  );
  assert.deepEqual(calls, ['read ticket-1', 'claim ticket-1 as desk-1 with key-1']);
  assert.deepEqual(trees.made, []);
  assert.equal(runs.where('ticket-1'), null);
});

test('a run the server will not start gives the claim back rather than holding it', async () => {
  const { runs, calls, trees } = keeper({
    folder: folderMade(),
    refuseStart: 'That ticket is already being run.',
  });

  await assert.rejects(() => runs.start('workspace-1', 'ticket-1'), /already being run/);

  // Nothing is standing on that claim: the run it was taken for never began, and a ticket
  // claimed by a run nobody is working is off the queue and out of reach.
  assert.deepEqual(calls, [
    'read ticket-1',
    'claim ticket-1 as desk-1 with key-1',
    'start ticket-1 as desk-1',
    'release ticket-1',
  ]);
  assert.deepEqual(trees.made, []);
  assert.deepEqual(runs.driving(), []);
});

test('a folder that is gone refuses Run rather than claiming a ticket it cannot work', async () => {
  const { runs, calls } = keeper({ folder: join(tmpdir(), 'kira-not-there-at-all') });

  await assert.rejects(() => runs.start('workspace-1', 'ticket-1'), /not there any more/);
  assert.deepEqual(calls, []);
});

test('a workspace that is no longer open refuses Run', async () => {
  const { runs, calls } = keeper({ folder: undefined });

  await assert.rejects(() => runs.start('workspace-1', 'ticket-1'), /no longer open/);
  assert.deepEqual(calls, []);
});

test('a run that cannot be afforded is ended saying so, and costs nothing', async () => {
  const { runs, calls, trees } = keeper({ folder: folderMade(), affordable: false });

  await assert.rejects(() => runs.start('workspace-1', 'ticket-1'), /nothing left this month/);
  // Started and ended rather than never begun, so the ticket says why it is waiting
  // instead of looking untouched — and no checkout was ever made.
  assert.deepEqual(calls, [
    'read ticket-1',
    'claim ticket-1 as desk-1 with key-1',
    'start ticket-1 as desk-1',
    'end run-1 {"stoppedBecause":"There is nothing left this month to run it with."}',
  ]);
  assert.deepEqual(trees.made, []);
  assert.equal(runs.where('ticket-1'), null);
});

test('a checkout that cannot be made ends the run saying so rather than leaving it claimed', async () => {
  const { runs, calls } = keeper({ folder: folderMade(), canMake: false });

  await assert.rejects(() => runs.start('workspace-1', 'ticket-1'), /checkout to work in/);
  assert.deepEqual(calls, [
    'read ticket-1',
    'claim ticket-1 as desk-1 with key-1',
    'start ticket-1 as desk-1',
    'worktree fnd-1-a-ticket-a-run-works-on',
    'end run-1 {"stoppedBecause":"A checkout to work in could not be made."}',
  ]);
  assert.equal(runs.where('ticket-1'), null);
});

test('a machine that is not running a ticket cannot finish or stop one', async () => {
  const { runs } = keeper({ folder: folderMade() });

  await assert.rejects(() => runs.finish('ticket-9', { changed: 'x' }), /not running that ticket/);
  await assert.rejects(() => runs.stop('ticket-9', 'x'), /not running that ticket/);
  assert.equal(runs.where('ticket-9'), null);
});

test('Let it go gives the claim back and stops driving the run it was carrying', async () => {
  const { runs, calls, trees, chatting } = keeper({ folder: folderMade() });
  await runs.start('workspace-1', 'ticket-1');
  calls.length = 0;

  await runs.letClaimGo('ticket-1');

  // The server ends the run the claim was carrying, so this machine lets go of it too:
  // the claim goes back, the chat stops, the checkout is dropped, and it stops saying it
  // is driving a run that is over (GH #68, #75).
  assert.deepEqual(calls, ['release ticket-1', 'close the chat', 'drop /runs/ticket-1']);
  assert.deepEqual(trees.dropped, ['/runs/ticket-1']);
  assert.deepEqual(runs.driving(), []);
  assert.equal(runs.where('ticket-1'), null);
  assert.equal(chatting.chat.threadId, 'run-1');
});

test('Let it go on a claim this machine is not driving only gives it back', async () => {
  const { runs, calls } = keeper({ folder: folderMade() });

  await runs.letClaimGo('ticket-1');

  assert.deepEqual(calls, ['release ticket-1']);
});

test('the transcript is read from the server, where it outlives the run and the app', async () => {
  const { runs, calls } = keeper({ folder: folderMade() });

  const said: TicketSaid[] = await runs.saidIn('ticket-1', 'run-1');

  assert.deepEqual(said, []);
  assert.deepEqual(calls, ['transcript of run-1']);
});

test('nobody signed in cannot press Run, and cannot read a transcript either', async () => {
  const { runs, calls } = keeper({ folder: folderMade(), signedIn: false });

  await assert.rejects(() => runs.start('workspace-1', 'ticket-1'), /Nobody is signed in/);
  await assert.rejects(() => runs.saidIn('ticket-1', 'run-1'), /Nobody is signed in/);
  assert.deepEqual(calls, []);
});
