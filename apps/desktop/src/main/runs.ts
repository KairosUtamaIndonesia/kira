/**
 * Pressing Run, and what becomes of the run.
 *
 * Run is the one act in Foundry that spends somebody's money on work nobody is watching,
 * so the order here is the design. The claim comes first, because the server is the party
 * that knows whether a ticket can be picked up and refuses it in its own words. Then the
 * run is started, because a run that cannot begin is recorded saying why rather than
 * vanishing — a ticket that says nothing is indistinguishable from one nobody touched.
 * Then the checkout, because that is the first thing that can fail on this machine. Only
 * then is there anything to work in, and only then does a chat have somewhere to be.
 *
 * A run is a chat with a ticket behind it (docs/adr/0012), so the work is a turn: the
 * keeper sets the chat going on the ticket's own words and is *told* when it stops rather
 * than waiting here for it. Watching is a choice — the turn goes on when nobody is looking,
 * and the row it leaves in the sidebar is one line in a list.
 *
 * What a run says is kept on the ticket as it is said, not at the end, because the end is
 * exactly the thing that might not happen: an app that closed mid-run should leave an
 * afternoon's worth of work on the ticket rather than none of it. So the transcript is
 * written through as lines settle, and the proposal is what is added when the turn ends:
 * what changed, and what it ran.
 *
 * The checkout goes when the run does and the branch stays (docs/adr/0011). A run that
 * ended is finished; the branch is the ticket's, so a second try carries on from it.
 */
import { existsSync } from 'node:fs';
import type { Ticket, TicketRun, TicketSaid } from '../preload/bridge.ts';
import type { RunChat } from './pi/runChat.ts';
import { asked, type TrackerWire } from './tracker.ts';
import type { Worktrees } from './workspace/worktrees.ts';

const MAP_RUN_REFUSAL = 'Map tickets are planning records and cannot be run.';

/** What a run made, as its driver reports it. */
export interface RunEvidence {
  /** What changed, in a sentence somebody can read. */
  changed: string;
  /** The commands that were run to find out whether it was done, as lines. */
  checks?: string[];
  /** What the run made of it, in its own words. */
  made?: string;
  /** Sources cited by research, kept separate from shell checks. */
  sources?: string[];
}

/** Running a ticket, as the main process does it. */
export interface Runs {
  /**
   * Press Run: take the claim, start the run, make the checkout, and set the run's chat
   * going on the ticket. Answers the run, or throws the sentence saying why it could not
   * begin. The turn itself goes on after this has answered.
   */
  start(workspaceId: string, ticketId: string): Promise<TicketRun>;
  /** A run has done what it was asked: record what it made and end it as a proposal. */
  finish(ticketId: string, evidence: RunEvidence): Promise<TicketRun>;
  /** A run cannot go on, or cannot begin: end it saying why, and let its checkout go. */
  stop(ticketId: string, reason: string): Promise<TicketRun>;
  /** Where a ticket's run is working, or null when this machine is not running it. */
  where(ticketId: string): string | null;
  /** What was said while a run went on, oldest first. */
  saidIn(ticketId: string, runId: string): Promise<TicketSaid[]>;
  /** Whether a run is in flight on this machine right now. */
  /**
   * The tickets this machine is running right now.
   *
   * The worker says this when it says it is still here, because being here is not the same
   * as working: a desktop that restarted is here with nothing in flight, and refreshing a
   * run's lease from a machine no longer driving it leaves a ticket reading Running for good
   * (GH #74, #75).
   */
  driving(): string[];
  /**
   * Take over a claim whose lease has run out, by hand.
   *
   * By hand because the machine that held it is not answering: this is a person saying
   * they are working the ticket now, and a claim made this way never goes stale on its own.
   */
  takeOverClaim(ticketId: string): Promise<Ticket>;
  /** Let a claim go — a run's, or one held by hand — so the ticket is free again. */
  letClaimGo(ticketId: string): Promise<void>;
  /** Accept a run's proposal, or send it back to a person's work list. */
  judge(
    ticketId: string,
    runId: string,
    verdict: 'accepted' | 'sent-back',
    workspaceId?: string,
  ): Promise<TicketRun>;
  /** Start another run on a conflicted ticket, asking Kira to bring its branch up to date. */
  resolve(workspaceId: string, ticketId: string, reason: string): Promise<TicketRun>;
}

/** What a run is holding while it works, which only this machine knows. */
interface Working {
  runId: string;
  folder: string;
  into: string;
  /** Its chat, once there is one: a run that failed before that has none. */
  chat: RunChat | null;
  /** The kind controls whether ending this run also records an Outcome. */
  kind: Ticket['kind'];
  /** The last thing it said, which is what a proposal's summary is made of. */
  said: string | null;
}

export function runsFor({
  token,
  workerOf,
  folderOf,
  thereFor,
  affordable,
  worktrees,
  chatFor,
  wire,
}: {
  /** The key this device holds, or null when nobody has signed in. */
  token: () => Promise<string | null>;
  /** What this desktop is called as a worker, or null when nobody is signed in. */
  workerOf: () => Promise<string | null>;
  /** The folder a workspace works in, or undefined when it is no longer open. */
  folderOf: (workspaceId: string) => string | undefined;
  /** Where a ticket's run should work, from this machine's own paths. */
  thereFor: (ticketId: string) => string;
  /** Whether there is allowance left to spend on a run. */
  affordable: () => boolean;
  worktrees: Worktrees;
  /** The chat a run works in, in the checkout it was given. */
  chatFor: (
    ticket: Ticket,
    folder: string,
    id: string,
    workspaceId: string,
    resolutionReason?: string,
  ) => Promise<RunChat>;
  wire: TrackerWire;
}): Runs {
  // Runs this machine is working, by ticket. A run is this app's own act, so nothing else
  // is told where the checkout is — and a run whose app closed is a claim left stale
  // rather than a run lost (GH #74).
  const workingRuns = new Map<string, Working>();
  /** The project checkout a completed run belongs to, retained for its later judgement. */
  const runFolders = new Map<string, string>();

  /** The key, or the sentence a window shows when there is none. */
  async function key(): Promise<string> {
    const held = await token();
    if (held === null) throw new Error('Nobody is signed in to Foundry.');

    return held;
  }

  /**
   * Take a run's checkout away, leaving its branch, and forget it was ever working.
   *
   * The chat goes with it: a run that is over is not a chat, and the row leaving the
   * sidebar is what says so. A run that failed before it had one has nothing to close.
   */
  async function letGo(ticketId: string): Promise<void> {
    const run = workingRuns.get(ticketId);
    if (run === undefined) return;

    workingRuns.delete(ticketId);
    run.chat?.close();
    await worktrees.drop(run.folder, run.into);
  }

  /**
   * End a run that cannot begin, and answer the sentence to show.
   *
   * The claim goes with it: a ticket left claimed by a run that never started would be
   * off the queue and out of reach, which is worse than the refusal it is meant to be.
   */
  async function gaveUp(ticketId: string, runId: string, reason: string): Promise<string> {
    const held = await token();
    if (held !== null) {
      await wire.endRun(held, ticketId, runId, { stoppedBecause: reason }).catch(() => {});
    }

    return reason;
  }

  async function startRun(
    workspaceId: string,
    ticketId: string,
    resolutionReason?: string,
  ): Promise<TicketRun> {
    const held = await key();

    const folder = folderOf(workspaceId);
    if (folder === undefined) throw new Error('That folder is no longer open.');
    // Refused here rather than after the claim: a run in a folder that is not there
    // cannot begin, and claiming a ticket for it would only take it off the queue.
    if (!existsSync(folder)) {
      throw new Error('That folder is not there any more, so nothing can run in it.');
    }

    // Maps chart work but are never themselves runs. Read the current ticket through the
    // tracker seam before claiming anything so a planning record stays on the queue.
    const ticket = await asked(() => wire.readTicket(held, ticketId));
    if (ticket.kind === 'map') throw new Error(MAP_RUN_REFUSAL);

    const worker = await workerOf();
    const spec = await enclosingSpec(ticket, held, wire);

    // A spec branch is shared by its slices and its integration run. Prepare it before
    // claiming anything: a remote refusal must leave the ticket on the queue.
    if (spec !== null && (await worktrees.prepareSpec(folder, spec.branch)) === null) {
      throw new Error(
        'The spec branch could not be prepared because its configured remote could not be reached or pushed.',
      );
    }

    // The server's own words when the ticket is not ready, or is somebody else's.
    const claimed = await asked(() => wire.claimTicket(held, ticketId, worker));

    // The claim was taken a line ago, so a run that cannot start has to give it back: the
    // claim is what takes the ticket off the queue, and nothing is standing on this one, so
    // keeping it leaves a ticket claimed by a run that never began — off the queue, out of
    // reach, and worse than the refusal it is meant to be (GH #74, #75).
    let run: TicketRun;
    try {
      run = await asked(() => wire.startRun(held, ticketId, worker));
    } catch (failure) {
      await wire.releaseTicket(held, ticketId).catch(() => {});
      throw failure;
    }

    // Affordability is asked once, here, rather than watched while the run goes: work
    // that cannot be paid for should not begin, and a run stopped halfway has spent
    // what it spent. Ending it anyway is what makes the refusal visible — the ticket
    // lands in `Needs you` saying why rather than looking untouched.
    if (!affordable()) {
      throw new Error(
        await gaveUp(ticketId, run.id, 'There is nothing left this month to run it with.'),
      );
    }

    const into = thereFor(ticketId);
    const made = await worktrees.make(folder, claimed.branch, into, spec?.branch);
    if (made === null) {
      throw new Error(await gaveUp(ticketId, run.id, 'A checkout to work in could not be made.'));
    }

    const working: Working = {
      runId: run.id,
      folder,
      into,
      chat: null,
      kind: 'feature',
      said: null,
    };
    workingRuns.set(ticketId, working);
    runFolders.set(ticketId, folder);

    // The branch that exists, rather than the one derived from the title: a retitle
    // changes the derived name and must not change the branch a run already made
    // (GH #64).
    const recorded = await asked(() =>
      wire.recordRun(held, ticketId, run.id, { branch: claimed.branch }),
    );

    try {
      // The ticket was read before the claim so a map stays off the run queue and a spec
      // remote can be checked without taking work off the queue. Its words still name the
      // run's contract and kind-specific behavior.
      working.kind = ticket.kind;
      // The chat is named for its run: thread ids and run ids are both random, so one
      // id serves for both, and the row in the sidebar, the transcript on the ticket
      // and the run record are three views of one thing rather than three to keep in
      // step.
      const chat = await chatFor(ticket, into, run.id, workspaceId, resolutionReason);
      working.chat = chat;

      chat.onLine((line) => {
        if (line.saidBy === 'agent') working.said = line.words;
        void asked(() =>
          wire.sayInRun(held, ticketId, run.id, {
            saidBy: line.saidBy,
            words: line.words,
          }),
        ).catch(() => {});
      });

      // The turn is not waited for: a run somebody is watching is not a run that needs
      // watching, and the ticket is where what it does shows up.
      void chat
        .begin(claimed.branch, resolutionReason)
        .then(() => proposes(ticketId, chat))
        .catch((failure: unknown) => fellOver(ticketId, failure));
    } catch (failure) {
      // A chat that could not be started is a run that cannot go on: the checkout and
      // the claim go, and the ticket says why rather than sitting in Running.
      await stopRun(ticketId, `The run could not be started: ${say(failure)}`).catch(() => {});
      throw failure;
    }

    return recorded;
  }

  async function finishRun(ticketId: string, evidence: RunEvidence): Promise<TicketRun> {
    const held = await key();
    const run = workingRuns.get(ticketId);
    if (run === undefined) throw new Error('This machine is not running that ticket.');

    try {
      const ended = await asked(() =>
        wire.endRun(held, ticketId, run.runId, {
          changed: evidence.changed,
          ...(evidence.checks === undefined ? {} : { checks: evidence.checks }),
          ...(evidence.made === undefined ? {} : { made: evidence.made }),
        }),
      );
      if (run.kind === 'research' && wire.recordOutcome !== undefined) {
        const answer = evidence.made ?? evidence.changed;
        const sources =
          evidence.sources ?? urlsIn(`${answer}\n${(evidence.checks ?? []).join('\n')}`);
        if (sources.length === 0) throw new Error('Research needs at least one cited source.');
        await asked(() => wire.recordOutcome!(held, ticketId, { answer, sources }));
      }
      return ended;
    } finally {
      await letGo(ticketId);
    }
  }

  async function stopRun(ticketId: string, reason: string): Promise<TicketRun> {
    const held = await key();
    const run = workingRuns.get(ticketId);
    if (run === undefined) throw new Error('This machine is not running that ticket.');

    try {
      return await asked(() => wire.endRun(held, ticketId, run.runId, { stoppedBecause: reason }));
    } finally {
      await letGo(ticketId);
    }
  }

  // Read from the server rather than from the chat in memory, because the transcript is
  // the ticket's: it is there after the run has ended, after the app has closed, and for
  // somebody who was never at this machine at all.
  async function saidInRun(ticketId: string, runId: string): Promise<TicketSaid[]> {
    const held = await key();

    return await asked(() => wire.readTranscript(held, ticketId, runId));
  }

  return {
    start: startRun,
    finish: finishRun,
    stop: stopRun,
    where: (ticketId) => workingRuns.get(ticketId)?.into ?? null,
    saidIn: saidInRun,
    driving: () => [...workingRuns.keys()],
    takeOverClaim: takeOverRun,
    letClaimGo: letClaimGo,
    judge: judgeRun,
    resolve: (workspaceId, ticketId, reason) => startRun(workspaceId, ticketId, reason),
  };

  /** Find the nearest enclosing spec through the tracker's gate edges. */
  async function enclosingSpec(
    ticket: Ticket,
    held: string,
    tracker: TrackerWire,
  ): Promise<Ticket | null> {
    if (ticket.kind === 'spec' || ticket.gates.length === 0)
      return ticket.kind === 'spec' ? ticket : null;

    const queue = await asked(() => tracker.queue(held, ticket.projectId));
    const seen = new Set<string>();
    let current = ticket;

    while (current.kind !== 'spec' && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = queue.tickets.find((candidate) =>
        current.gates.some((gate) => gate.id === candidate.id),
      );
      if (parent === undefined) return null;
      current = parent;
    }

    return current.kind === 'spec' ? current : null;
  }

  /** Take a claim over by hand, which is only ever allowed on one that has gone stale. */
  async function takeOverRun(ticketId: string): Promise<Ticket> {
    const held = await key();

    return await asked(() => wire.takeOverTicket(held, ticketId));
  }

  /** Let a claim go: the ticket leaves Running and goes back to the queue. */
  async function letClaimGo(ticketId: string): Promise<void> {
    const held = await key();

    await asked(() => wire.releaseTicket(held, ticketId));

    // Letting the claim go is letting the run go: the server ends the run that claim was
    // carrying, so this machine stops driving it — the chat stops, the checkout is thrown
    // away, and it stops saying it is driving a run that is over (GH #68, #75).
    await letGo(ticketId);
  }

  /** A person's judgement on what a run made. Acceptance integrates before it is recorded. */
  async function judgeRun(
    ticketId: string,
    runId: string,
    verdict: 'accepted' | 'sent-back',
    workspaceId?: string,
  ): Promise<TicketRun> {
    const held = await key();

    if (verdict === 'sent-back') {
      return await asked(() => wire.judgeRun(held, ticketId, runId, verdict));
    }

    const ticket = await asked(() => wire.readTicket(held, ticketId));
    const spec = await enclosingSpec(ticket, held, wire);

    // The integration run already works on the spec branch. Only a slice has another
    // branch to bring into it; an outside-spec ticket keeps its existing branch behavior.
    if (spec !== null && ticket.kind !== 'spec') {
      const run = ticket.runs.find((each) => each.id === runId);
      if (run?.branch === null || run === undefined) {
        throw new Error('The accepted run has no branch to merge into the spec.');
      }

      const merged = await worktrees.mergeSpec(
        folderFor(ticket, workspaceId),
        spec.branch,
        run.branch,
      );
      if (merged.kind === 'conflict') {
        throw new Error(`Merge conflict: ${merged.reason}`);
      }
      if (merged.kind === 'refused') {
        throw new Error(`The spec branch could not be pushed: ${merged.reason}`);
      }
    }

    // The server closes the ticket in the same transaction as this verdict. It is called
    // only after integration has succeeded, so neither a conflict nor a refused push can
    // leave a misleading accepted run behind.
    return await asked(() => wire.judgeRun(held, ticketId, runId, verdict));
  }

  function folderFor(ticket: Ticket, workspaceId?: string): string {
    if (workspaceId !== undefined) {
      const folder = folderOf(workspaceId);
      if (folder !== undefined) return folder;
      throw new Error('That folder is no longer open.');
    }

    const folder = runFolders.get(ticket.id);
    if (folder !== undefined) return folder;

    throw new Error('The run is no longer available on this desktop.');
  }

  /**
   * The run stopped writing: whatever it made is its proposal.
   *
   * Nothing is decided here about whether the work is any good — that is the judgement of
   * the person the ticket is for, and what it produced is what they judge.
   */
  async function proposes(ticketId: string, chat: RunChat): Promise<void> {
    const run = workingRuns.get(ticketId);
    if (run === undefined) return;

    const changed = await worktrees.changed(run.folder, run.into);
    const checks = chat.ran();

    await finishRun(ticketId, {
      changed: changed ?? 'Nothing was changed.',
      ...(checks.length === 0 ? {} : { checks }),
      ...(run.said === null ? {} : { made: run.said }),
    }).catch(() => {});
  }

  /** The turn fell over: end the run saying so, rather than leaving it claimed and silent. */
  async function fellOver(ticketId: string, failure: unknown): Promise<void> {
    await stopRun(ticketId, `The run stopped: ${say(failure)}`).catch(() => {});
  }

  function say(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure);
  }
}

function urlsIn(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s)]+/g) ?? [])];
}
