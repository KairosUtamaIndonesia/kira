/**
 * What a ticket's row is drawn from, worked out away from the drawing.
 *
 * The Work surface reads a queue the server derived, so nothing here decides a
 * band — that would be the one thing the window is not allowed to decide. What it
 * does decide is what a band looks like, what one line says about a ticket, and
 * when something happened: small facts with several cases each, which is exactly
 * the shape that belongs in a file with tests beside it rather than in the middle
 * of the markup (`chatOrdering.ts` and `memoryGroups.ts` are the same move).
 */
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
import type { LucideIcon } from 'lucide-react';
import type { Band, SaidBy, Ticket, TicketRun } from '../../preload/bridge.ts';

/**
 * The icon a ticket's state is drawn with, wherever it is drawn small.
 *
 * A closed ticket is not a band of its own — Done holds both reasons — so the
 * reason decides the icon: a `wontfix` is an alert rather than a tick, because
 * work that was abandoned should not read as work that was delivered.
 */
export function bandIcon(ticket: Ticket): LucideIcon {
  if (ticket.closedAt !== null) return ticket.closure === 'wontfix' ? CircleAlert : CircleCheck;
  if (ticket.claim !== null) return Loader;
  if (ticket.band === 'needs-you') return CircleHelp;
  if (ticket.band === 'ready') return Play;
  if (ticket.band === 'blocked') return Clock;

  return FileText;
}

/**
 * What a ticket is waiting on, in one line: the icon, and the words beside it.
 *
 * One answer rather than two, so the icon and the sentence cannot disagree — a
 * clock beside "ready to run" is the kind of thing that happens when they are
 * worked out in two places. A closed ticket says which reason it was closed with;
 * a parent says how many of the tickets it named are closed; anything else is
 * where its gate stands.
 */
export function holding(
  ticket: Ticket,
  now: number = Date.now(),
): { icon: LucideIcon; words: string } {
  if (ticket.closedAt !== null) {
    return ticket.closure === 'wontfix'
      ? { icon: CircleAlert, words: 'closed without being done' }
      : { icon: CircleCheck, words: 'done' };
  }

  // Somebody is on it. Who, and for how long: a claim that has gone quiet reads the same
  // as one being worked otherwise, and the difference is the whole of what a person needs
  // to decide whether to take it over.
  if (ticket.claim !== null) {
    const quiet = ticket.claim.stale ? ', gone quiet' : ` ${howLong(ticket.claim.startedAt, now)}`;

    return {
      icon: ticket.claim.stale ? CircleAlert : Loader,
      words: `held by ${ticket.claim.holder.name}${quiet}`,
    };
  }

  if (ticket.band === 'needs-you') {
    return { icon: CircleHelp, words: whyWaiting(ticket) };
  }

  const open = ticket.children.filter((each) => !each.closed).length;
  if (open > 0) {
    return {
      icon: Clock,
      words: `${ticket.children.length - open} of ${ticket.children.length} closed`,
    };
  }

  return {
    icon: ticket.gate === 'draft' ? CircleDashed : Play,
    words: GATE_WORDS[ticket.gate],
  };
}

/**
 * Why a ticket is waiting on a person rather than on the queue.
 *
 * A run that stopped said why in its own words, and those are the words to show: the
 * reason a proposal is sitting there is the reason the run gave. A run that ended without
 * saying anything left a proposal, which is what waiting means when nothing else does.
 */
export function whyWaiting(ticket: Ticket): string {
  const last = ticket.runs[0];
  if (last === undefined) return 'waiting on a person';

  return last.stoppedBecause ?? 'a proposal nobody has answered';
}

/**
 * How long something has been held, in words: "for 3 minutes".
 *
 * Not `when`, which says when something happened; a claim is read as an age, because the
 * question a person is asking is whether it has gone quiet for long enough to step in.
 */
export function howLong(iso: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);

  if (minutes < 1) return 'for a moment';
  if (minutes < 60) return `for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `for ${hours} ${hours === 1 ? 'hour' : 'hours'}`;

  return 'for days';
}

/** Where a ticket stands with whoever might resolve it, in a row's own words. */
const GATE_WORDS: Record<Ticket['gate'], string> = {
  draft: 'draft',
  'ready-for-agent': 'ready for an agent',
  'ready-for-human': 'ready for a person',
};

/** The tickets in one band, in the order the server put them in. */
export function inBand(tickets: Ticket[], band: Band | 'draft'): Ticket[] {
  return tickets.filter((each) => each.band === band);
}

/** A spec with no child tickets still needs to be broken into work. */
export function isUnbrokenSpec(ticket: Ticket): boolean {
  return ticket.kind === 'spec' && ticket.children.length === 0;
}

/**
 * The ticket a band opens on, so a reading with nowhere to put an unopened ticket
 * — Split's detail pane — is never blank.
 */
export function firstIn(tickets: Ticket[], band: Band | 'all'): Ticket | undefined {
  return band === 'all' ? tickets[0] : inBand(tickets, band)[0];
}

/**
 * When something happened, near enough to read at a glance.
 *
 * `now` is a parameter so a test can say what "ago" means without waiting: the
 * caller passes nothing and the clock is the clock.
 */
export function when(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  // Rounded down, so the first minute is the first minute: "1 minute ago" before a
  // minute has passed is a clock that cannot be trusted for anything else either.
  const minutes = Math.floor((now - at.getTime()) / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  return at.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/**
 * How a run stands, in a word: what it is doing, or what became of it.
 *
 * Ended and unanswered is the state a ticket is waiting in, so it says so in words rather
 * than in the absence of a verdict — a proposal nobody has read looks the same as one
 * nobody has answered otherwise, and only one of those is waiting on anybody.
 */
export function howItWent(run: TicketRun): string {
  if (run.endedAt === null) return 'still going';
  if (run.verdict === 'accepted') return 'accepted';
  if (run.verdict === 'sent-back') return 'sent back';
  if (run.stoppedBecause !== null) return 'stopped';

  return 'waiting for you';
}

/**
 * How a run stands, in one line: when it went, and how it went.
 *
 * The reason a stopped run stopped is said here rather than in the list of a ticket's runs,
 * because what a person is waiting on is the run's own account of it.
 */
export function runTelling(run: TicketRun, now: number = Date.now()): string {
  if (run.endedAt === null) return `started ${when(run.startedAt, now)} · ${howItWent(run)}`;

  const ended = `ended ${when(run.endedAt, now)}`;

  // A run that stopped says why, unless it has since been answered: the reason is what
  // somebody was waiting on, and once there is a verdict that is no longer true.
  if (run.verdict === null && run.stoppedBecause !== null) {
    return `${ended} · stopped: ${run.stoppedBecause}`;
  }

  return `${ended} · ${howItWent(run)}`;
}

/**
 * What a run is listed as on its ticket: the day and time it started, and how it went.
 *
 * The time is written out rather than said as "9 hours ago", because a ticket run several
 * times in one day would otherwise list several lines that read the same — and telling
 * those runs apart is the only thing such a list is for.
 */
export function runChoiceLabel(run: TicketRun): string {
  const started = new Date(run.startedAt);
  const day = started.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const hours = String(started.getHours()).padStart(2, '0');
  const minutes = String(started.getMinutes()).padStart(2, '0');

  return `${day} ${hours}:${minutes} · ${howItWent(run)}`;
}

/**
 * Who a line in a run's transcript is drawn as.
 *
 * By what they are rather than by name, because the transcript records only which of the
 * three said it: the person steering, the agent working, or Foundry itself. "You" is the
 * person at this window, which is who a run started from here is steered by.
 *
 * A run's first line is the one exception, and it is not a person speaking: Foundry opens
 * every run by telling the agent which ticket it is running and what the ticket asks for,
 * and that brief is the contract the run worked to. Drawing it as "you" would put words in
 * somebody's mouth and hide the one thing a person judging the work needs — what the agent
 * was actually asked for (GH #74).
 */
export function saidByLabel(saidBy: SaidBy, opening = false): string {
  if (opening && saidBy === 'person') return 'the brief it started from';
  if (saidBy === 'agent') return 'Kira';
  if (saidBy === 'note') return 'Foundry';

  return 'you';
}

/**
 * What the branch line says: whether a run has made this branch yet.
 *
 * The name is derived from the ticket, so it exists before anything does — but a run makes
 * the branch as it starts, and the ticket answers with the one it made. A ticket that has
 * been worked would otherwise be told nothing here makes it, which is the one thing a
 * person can see for themselves (GH #64).
 */
export function branchNote(ticket: Ticket): string {
  const made = ticket.runs.some((each) => each.branch === ticket.branch);

  return made
    ? 'The branch a run made for this ticket. It is kept when the run\u2019s checkout is thrown away.'
    : 'What a branch for this ticket would be called. Nothing here makes it: work it by hand, or let a run make the same one later.';
}

/**
 * The ticket someone meant, when they say its name.
 *
 * A project names its tickets `FND-12`, and a name is what a person has in hand
 * when they have nothing else — a chat message, a commit, somebody talking. The
 * queue already holds every ticket in the project in full, so this looks in what
 * is already loaded rather than reading one from the server the window is already
 * holding: opening by name adds no route and asks nothing new.
 *
 * Case and space around it are not part of a name, because both arrive by being
 * typed or pasted, and the server reads a name in either case too. The name is
 * matched whole — `FND-1` is not `FND-12` — so a near miss says it found nothing
 * instead of opening the wrong ticket.
 *
 * Only the name is matched, not the opaque id the wire uses. The server's own
 * `resolve` takes either, because a route may be handed an id; somebody opening a
 * ticket has a name in hand, and the field asks for one.
 */
export function byName(tickets: Ticket[], said: string): Ticket | undefined {
  const wanted = said.trim().toUpperCase();

  return wanted === '' ? undefined : tickets.find((each) => each.name.toUpperCase() === wanted);
}

/**
 * A prefix to offer for a project being made: the folder's name, if it can be one.
 *
 * The suggestion is always one the server will take — two to six characters,
 * starting with a letter — because a suggestion that is refused teaches nothing
 * except that the form was not thinking. The person edits it either way, and the
 * server is what finally decides whether it is free.
 */
export function suggestPrefix(name: string): string {
  const letters = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

  if (letters === '') return 'PROJ';

  const started = /^[A-Z]/.test(letters) ? letters : `F${letters}`.slice(0, 6);

  return started.length >= 2 ? started : `${started}X`;
}
