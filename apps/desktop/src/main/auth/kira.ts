/**
 * The Kira server, as the desktop talks to it.
 *
 * The one module that knows the wire: which of Kira's endpoints the app
 * calls, what they answer, and how Better Auth's Electron client is set up to
 * reach them. It is deliberately thin — every decision about *when* to call
 * what lives in `signIn.ts`, which is exercisable without a server — and it is
 * the one part of sign-in a node test cannot reach, because reaching it takes
 * the Electron main process.
 */
import { electronClient } from '@better-auth/electron/client';
import { treaty } from '@elysiajs/eden';
import type { App } from '@kira/server/contract';
import { createAuthClient } from 'better-auth/client';
import { isAuthUser, type AuthUser } from '../../preload/bridge.ts';
import {
  SAID_BY,
  type GlossaryEntry,
  type Outcome,
  type OutcomeProposal,
  type ProjectDecision,
  type BreakdownResult,
  TICKET_BANDS,
  TICKET_CLOSURES,
  TICKET_GATES,
  TICKET_KINDS,
  type ProjectSummary,
  type Ticket,
  type TicketQueue,
  type TicketRun,
  type TicketSaid,
  type WorkerStanding,
} from '../../preload/bridge.ts';
import type { TrackerAnswer } from '../tracker.ts';
import { type Kira, RETURN_PATH } from './signIn.ts';

/**
 * The server, with the client the hand-off is built on.
 *
 * The library is used for the part that is genuinely its own — building the
 * PKCE pair, opening the system browser, and trading the one-time token for a
 * session. The session is then used to mint this device a key and ended: the
 * key is what the machine keeps, and the cookies are held in memory for the run
 * so that there is no second thing on the disk (docs/adr/0004-sign-in.md).
 */
export function kiraFor({ server, scheme }: { server: string; scheme: string }): Kira {
  const cookies = new Map<string, string>();
  const electron = electronClient({
    // Required by the client's options, and the entry point for a sign-in that
    // starts in a browser. The app does not use it: naming a provider sends
    // sign-in through the hand-off instead.
    signInURL: `${server}/sign-in`,
    protocol: { scheme },
    callbackPath: RETURN_PATH,
    storage: {
      getItem: (name) => cookies.get(name) ?? null,
      setItem: (name, value) => {
        cookies.set(name, String(value));
      },
    },
  });

  const client = createAuthClient({
    baseURL: server,
    plugins: [
      {
        ...electron,
        // This package's declarations were generated against the DOM's
        // `RequestInit` and better-auth's against Node's, so the two disagree
        // about one optional field of a fetch option neither of us sets. The
        // rest of the plugin is left exactly as it is, so the calls it adds
        // stay typed.
        fetchPlugins: electron.fetchPlugins as never,
      },
    ],
  });

  // Kira's own routes, typed by the server itself: `App` is the type of the
  // app `createApp` returns, so the path, the body and the status codes below are
  // the server's rather than a second copy kept here by hand that drifts from it.
  // Only a type crosses this line — the contract is imported with `import type`,
  // so the server, Elysia, Better Auth and `node:sqlite` stay out of the bundle.
  //
  // This sits beside `client` rather than replacing it, and the split is the
  // intended shape: Better Auth's routes are the library's own surface and its
  // client types them, Eden covers what Kira wrote.
  const kira = treaty<App>(server);

  return {
    openSignIn: async () => {
      await client.requestAuth({ provider: 'microsoft' });
    },

    claim: async (token) => {
      // `throw: true` makes the client answer with the response body itself
      // rather than its `{ data, error }` envelope, so what comes back is the
      // token exchange's own `{ token, user }`.
      const answer = await client.authenticate({
        token,
        fetchOptions: { throw: true },
      });
      const who = userIn(answer);
      if (who === null) throw new Error('Kira did not say who signed in.');

      return who;
    },

    retireDeviceKeys: async (device) => {
      const { data } = await client.$fetch<{
        apiKeys: { id: string; name: string | null }[];
      }>('/api-key/list');

      for (const held of data?.apiKeys ?? []) {
        if (held.name !== device) continue;
        await client.$fetch('/api-key/delete', {
          method: 'POST',
          body: { keyId: held.id },
        });
      }
    },

    mintKey: async (device) => {
      const { data, error } = await client.$fetch<{ key: string }>('/api-key/create', {
        method: 'POST',
        body: { name: device },
      });
      if (error !== null || typeof data?.key !== 'string') {
        throw new Error(error?.message ?? 'Kira issued no key.');
      }

      return data.key;
    },

    check: async (key) => {
      try {
        const { data, status } = await kira.api.me.get({
          headers: { authorization: `Bearer ${key}` },
        });

        // A key the server has stopped honouring is the one answer worth
        // throwing a key away for. Anything else is the server being unable to
        // say, which is not the same thing (docs/adr/0006-key-storage.md).
        if (status === 401 || status === 403) return { kind: 'refused' };

        // The server's type says what it should answer; it does not make it so,
        // so what arrives is checked before it is believed. Any status that is
        // not a 200 carries no person and lands here too.
        return isAuthUser(data) ? { kind: 'ok', user: data } : { kind: 'unreachable' };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    catalog: async (key) => {
      try {
        const { data, status } = await kira.api.models.get({
          headers: { authorization: `Bearer ${key}` },
        });

        // Anything but a 200 is the server being unable to answer — a pool it
        // cannot reach, or a key it has stopped honouring — and none of those
        // is a catalog. What the answer *means* is read in `pi/models.ts`, which
        // is also what reads the copy of it kept on disk, so the shape is
        // understood in one place rather than two.
        return status === 200 ? { kind: 'ok', body: data } : { kind: 'unavailable' };
      } catch {
        return { kind: 'unavailable' };
      }
    },

    usage: async (key) => {
      try {
        const { data, status } = await kira.api.usage.get({
          headers: { authorization: `Bearer ${key}` },
        });

        // Only a 200 is an answer about usage. Anything else — a key the server
        // has stopped honouring, a pool it cannot reach — is the server unable to
        // say, which the window answers by leaving the number it has standing.
        return status === 200 ? { kind: 'ok', body: data } : { kind: 'unavailable' };
      } catch {
        return { kind: 'unavailable' };
      }
    },

    memory: async (key) => {
      try {
        const { data, status } = await kira.api.memory.get({
          headers: { authorization: `Bearer ${key}` },
        });

        // As with usage: only a 200 is an answer about memory. A server that
        // cannot be asked leaves the reading the app is already running on
        // standing, which is the whole reason the reading is held at all.
        return status === 200 ? { kind: 'ok', body: data } : { kind: 'unavailable' };
      } catch {
        return { kind: 'unavailable' };
      }
    },

    saveMemory: async (key, decided) => {
      try {
        const { data, status, error } = await kira.api.memory.put(decided, {
          headers: { authorization: `Bearer ${key}` },
        });

        if (status === 200) return { kind: 'ok', body: data };

        // A refusal is the server's own words, shown to the person where they
        // asked: it is the party that knows why it would not take, and "that
        // could not be saved" would leave them nothing to act on. A server that
        // cannot be reached at all is a different answer, and one the page says
        // nothing about rather than blaming the change.
        return {
          kind: 'refused',
          message: messageIn(error ?? data) ?? 'That change could not be saved.',
        };
      } catch {
        return { kind: 'unavailable' };
      }
    },

    endSession: async () => {
      await client.$fetch('/sign-out', { method: 'POST' });
    },

    // The tracker. Every one of these is one request, and every one of them answers
    // with the same four shapes: the body, the server's own sentence about why it
    // would not, nobody signed in, or nothing at all. Which of the four it is is
    // decided in `asked`, once — so no caller above has to read a status to know
    // whether a person is signed in.
    projects: async (key) =>
      asked(
        () => kira.api.projects.get({ headers: bearerFor(key) }),
        (data) => (data as { projects: ProjectSummary[] }).projects,
      ),

    createProject: async (key, made) =>
      asked(
        () => kira.api.projects.post(made, { headers: bearerFor(key) }),
        (data) => (data as { project: ProjectSummary }).project,
      ),

    queue: async (key, projectId) =>
      asked(
        () => kira.api.projects({ ref: projectId }).get({ headers: bearerFor(key) }),
        asQueue,
      ),

    decisions: async (key, projectId) =>
      asked(
        () => kira.api.projects({ ref: projectId }).decisions.get({ headers: bearerFor(key) }),
        (data) => asDecisions((data as { decisions: unknown }).decisions),
      ),

    createDecision: async (key, projectId, proposal) =>
      asked(
        () =>
          kira.api.projects({ ref: projectId }).decisions.post(
            {
              context: proposal.context,
              choice: proposal.choice,
              rejectedOptions: proposal.rejectedOptions,
              consequences: proposal.consequences,
              sourceChatId: proposal.sourceChatId,
              ...(proposal.supersedes === null ? {} : { supersedes: proposal.supersedes }),
            },
            { headers: bearerFor(key) },
          ),
        (data) => asDecision((data as { decision: unknown }).decision),
      ),

    glossary: async (key, projectId) =>
      asked(
        () => kira.api.projects({ ref: projectId }).glossary.get({ headers: bearerFor(key) }),
        (data) => asGlossaryList(data),
      ),

    updateGlossary: async (key, projectId, edit) =>
      asked(
        () =>
          kira.api.projects({ ref: projectId }).glossary.post(edit, { headers: bearerFor(key) }),
        (data) => asGlossary((data as { entry: unknown }).entry),
      ),

    undoGlossary: async (key, projectId, entryId, version, chatId) =>
      asked(
        () =>
          kira.api
            .projects({ ref: projectId })
            .glossary({ entryId })
            .undo.post({ version, chatId }, { headers: bearerFor(key) }),
        (data) => asGlossary((data as { entry: unknown }).entry),
      ),

    createMap: async (key, projectId, proposal) =>
      asked(
        () =>
          kira.api.projects({ ref: projectId }).maps.post(proposal, {
            headers: bearerFor(key),
          }),
        (data) => asTicket((data as { ticket: unknown }).ticket),
      ),

    approveDestinationSpec: async (key, mapTicketId, draft) =>
      asked(
        () =>
          kira.api.tickets({ ref: mapTicketId })['destination-spec'].post(draft, {
            headers: bearerFor(key),
          }),
        (data) => asTicket((data as { ticket: unknown }).ticket),
      ),

    writeTicket: async (key, projectId, draft) =>
      asked(
        () =>
          kira.api.projects({ ref: projectId }).tickets.post(draft, { headers: bearerFor(key) }),
        (data) => asTicket((data as { ticket: unknown }).ticket),
      ),

    changeTicket: async (key, ticketId, change) =>
      asked(
        () => kira.api.tickets({ ref: ticketId }).patch(change, { headers: bearerFor(key) }),
        (data) => asTicket((data as { ticket: unknown }).ticket),
      ),

    gateTicket: async (key, ticketId, gatedBy) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            .gates.post({ gatedBy }, { headers: bearerFor(key) }),
        (data) => asTicket((data as { ticket: unknown }).ticket),
      ),

    ungateTicket: async (key, ticketId, gatedBy) =>
      // Eden reads a non-GET's first argument as its body and only its second as the
      // options, so a delete says `undefined` where a body would go — otherwise the
      // headers are sent as the payload and the request arrives with no key.
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            .gates({ gatedBy })
            .delete(undefined, {
              headers: bearerFor(key),
            }),
        (data) => asTicket((data as { ticket: unknown }).ticket),
      ),

    publishBreakdown: async (key, specTicketId, children) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: specTicketId })
            .breakdown.post({ children }, { headers: bearerFor(key) }),
        asBreakdown,
      ),

    markBreakdownReady: async (key, specTicketId) =>
      asked(
        () =>
          kira.api.tickets({ ref: specTicketId }).breakdown.ready.post(undefined, {
            headers: bearerFor(key),
          }),
        asBreakdown,
      ),

    // The worker, which is the same four shapes and the same one request each: this
    // desktop saying it is here, saying so again, and saying goodbye. What comes back
    // is only whether the server took it, so the window's reading of itself is built
    // here from the fact that an answer arrived at all.
    registerWorker: async (key, made) =>
      asked(() => kira.api.workers.post(made, { headers: bearerFor(key) }), asStanding),

    heartbeatWorker: async (key, id, workspaces, driving) =>
      asked(
        () =>
          kira.api
            .workers({ id })
            .heartbeat.post({ workspaces, driving }, { headers: bearerFor(key) }),
        asStanding,
      ),

    workerGone: async (key, id) =>
      asked(
        () => kira.api.workers({ id }).delete(undefined, { headers: bearerFor(key) }),
        (data) => data,
      ),

    // A run of a ticket. The claim is what makes a run legal, so it is one request of its
    // own; the run is started, named, and ended on the ticket it belongs to.
    claimTicket: async (key, ticketId, workerId) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            .claim.post({ workerId }, { headers: bearerFor(key) }),
        (data) => asTicket((data as { ticket: unknown }).ticket),
      ),

    releaseTicket: async (key, ticketId) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            .claim.delete(undefined, { headers: bearerFor(key) }),
        (data) => data,
      ),

    startRun: async (key, ticketId, workerId) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            .runs.post({ workerId }, { headers: bearerFor(key) }),
        asRun,
      ),

    recordRun: async (key, ticketId, runId, recorded) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            .runs({ runId })
            .patch(recorded, { headers: bearerFor(key) }),
        asRun,
      ),

    endRun: async (key, ticketId, runId, ending) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            .runs({ runId })
            .end.post(ending, { headers: bearerFor(key) }),
        asRun,
      ),

    readTicket: async (key, ref) =>
      asked(
        () => kira.api.tickets({ ref }).get({ headers: bearerFor(key) }),
        (data) => asTicket((data as { ticket: unknown }).ticket),
      ),

    openQuestion: async (key, ticketId, chatId) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            ['question-chat'].post({ chatId }, { headers: bearerFor(key) }),
        (data) => asTicket((data as { ticket: unknown }).ticket),
      ),

    recordOutcome: async (key, ticketId, value) =>
      asked(
        () =>
          kira.api.tickets({ ref: ticketId }).outcome.post(value, { headers: bearerFor(key) }),
        (data) => asOutcome((data as { outcome: unknown }).outcome),
      ),

    approveOutcome: async (key, ticketId, value) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            .outcome.approve.post(value, { headers: bearerFor(key) }),
        (data) => asOutcome((data as { outcome: unknown }).outcome),
      ),

    takeOverTicket: async (key, ticketId) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            // By hand: no worker and no lease, so a claim taken over this way belongs to a
            // person and never expires on its own (GH #75).
            .claim.takeover.post({ workerId: null }, { headers: bearerFor(key) }),
        (data) => asTicket((data as { ticket: unknown }).ticket),
      ),

    judgeRun: async (key, ticketId, runId, verdict) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            .runs({ runId })
            .verdict.post({ verdict }, { headers: bearerFor(key) }),
        asRun,
      ),

    readTranscript: async (key, ticketId, runId) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            .runs({ runId })
            .transcript.get({ headers: bearerFor(key) }),
        (data) => asSaidList((data as { transcript: unknown }).transcript),
      ),

    sayInRun: async (key, ticketId, runId, said) =>
      asked(
        () =>
          kira.api
            .tickets({ ref: ticketId })
            .runs({ runId })
            .transcript.post(said, { headers: bearerFor(key) }),
        (data) => asSaid((data as { said: unknown }).said),
      ),
  };
}

/** The header every Kira route is asked with. */ function bearerFor(
  key: string,
): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

/** What a request answered, as Eden hands it over. */
interface Answered {
  data: unknown;
  status: number;
  error: unknown;
}

/**
 * One request to the server, and what it came to.
 *
 * Seven routes answer in the same four ways, so they are told apart once here
 * rather than seven times: a body that was understood, the server's own sentence
 * about refusing it, nobody signed in, or nothing at all. The last three are apart
 * on purpose — they are three different things for a window to say, and a folder
 * with no project, a machine nobody is signed in on and a server that cannot be
 * reached all look like "no work here" if they are folded together.
 */
async function asked<T>(
  call: () => Promise<Answered>,
  read: (data: unknown) => T | null,
): Promise<TrackerAnswer<T>> {
  try {
    const { data, status, error } = await call();
    if (status !== 200 || data === undefined || data === null) {
      return refusedBy(status, error ?? data);
    }

    const understood = read(data);

    return understood === null
      ? {
          kind: 'refused',
          message: 'Kira answered with something this build does not understand.',
        }
      : { kind: 'ok', body: understood };
  } catch {
    return { kind: 'unavailable' };
  }
}

/**
 * What a server that did not answer 200 said.
 *
 * A 401 is nobody signed in rather than a refusal about the request: the key this
 * machine holds has stopped being honoured, which is a different thing to show a
 * person than "that prefix is taken". Everything else is the server's own sentence,
 * because it is the party that knows why it would not take.
 */
function refusedBy(status: number, said: unknown): TrackerAnswer<never> {
  if (status === 401 || status === 403) return { kind: 'signed-out' };

  return {
    kind: 'refused',
    message: messageIn(said) ?? 'Kira would not take that.',
  };
}

/**
 * What a ticket looks like coming off the wire, before it is believed.
 *
 * The server documents four of its fields as one of a known set and types them as
 * strings — its own response schemas cannot express the set without breaking the
 * types every client is generated from — so the set is checked here, once, at the
 * boundary where bytes cross. A window that took them on trust would draw a band it
 * has no section for and a kind it has no word for; nothing else is checked, because
 * everything else being the wrong shape is a visible fault rather than a quiet one.
 */
interface WireTicket {
  kind: string;
  gate: string;
  band: string;
  closure: string | null;
  [field: string]: unknown;
}

function asTicket(body: unknown): Ticket | null {
  const held = body as WireTicket;
  const kind = oneOf(TICKET_KINDS, held?.kind);
  const gate = oneOf(TICKET_GATES, held?.gate);
  const band = oneOf(TICKET_BANDS, held?.band);
  const closure = held?.closure === null ? null : oneOf(TICKET_CLOSURES, held?.closure);

  if (kind === null || gate === null || band === null || closure === undefined) return null;

  return { ...held, kind, gate, band, closure } as Ticket;
}

function asBreakdown(body: unknown): BreakdownResult | null {
  const held = body as { spec?: unknown; children?: unknown[] };
  const spec = asTicket(held?.spec);
  const children = Array.isArray(held?.children) ? held.children.map(asTicket) : null;
  if (spec === null || children === null || children.some((each) => each === null)) return null;

  return { spec, children: children as Ticket[] };
}

function asQueue(body: unknown): TicketQueue | null {
  const held = body as { tickets?: unknown[] };
  if (!Array.isArray(held?.tickets)) return null;

  const tickets = held.tickets.map(asTicket);
  if (tickets.some((each) => each === null)) return null;

  return { ...(body as object), tickets } as TicketQueue;
}

function asDecision(body: unknown): ProjectDecision | null {
  const held = body as {
    id?: unknown;
    projectId?: unknown;
    context?: unknown;
    choice?: unknown;
    rejectedOptions?: unknown;
    consequences?: unknown;
    author?: unknown;
    sourceChatId?: unknown;
    supersededById?: unknown;
    createdAt?: unknown;
  };
  if (
    typeof held.id !== 'string' ||
    typeof held.projectId !== 'string' ||
    typeof held.context !== 'string' ||
    typeof held.choice !== 'string' ||
    !Array.isArray(held.rejectedOptions) ||
    !held.rejectedOptions.every((option) => typeof option === 'string') ||
    typeof held.consequences !== 'string' ||
    (held.author !== null && typeof held.author !== 'object') ||
    (held.sourceChatId !== null && typeof held.sourceChatId !== 'string') ||
    (held.supersededById !== null && typeof held.supersededById !== 'string')
  ) {
    return null;
  }
  const createdAt = whenIn(held.createdAt);
  if (createdAt === null) return null;

  return {
    id: held.id,
    projectId: held.projectId,
    context: held.context,
    choice: held.choice,
    rejectedOptions: held.rejectedOptions,
    consequences: held.consequences,
    author: held.author as ProjectDecision['author'],
    sourceChatId: held.sourceChatId as string | null,
    supersededById: held.supersededById as string | null,
    createdAt,
  };
}

function asDecisions(body: unknown): ProjectDecision[] | null {
  if (!Array.isArray(body)) return null;
  const decisions = body.map(asDecision);
  return decisions.some((each) => each === null) ? null : (decisions as ProjectDecision[]);
}

function asOutcome(body: unknown): Outcome | null {
  const held = body as {
    id?: unknown;
    ticketId?: unknown;
    answer?: unknown;
    sources?: unknown;
    decisionProposal?: unknown;
    author?: unknown;
    sourceChatId?: unknown;
    createdAt?: unknown;
  };
  if (
    typeof held.id !== 'string' ||
    typeof held.ticketId !== 'string' ||
    typeof held.answer !== 'string' ||
    !Array.isArray(held.sources) ||
    !held.sources.every((source) => typeof source === 'string') ||
    (held.sourceChatId !== null && typeof held.sourceChatId !== 'string') ||
    (held.author !== null && typeof held.author !== 'object')
  )
    return null;
  const proposal = held.decisionProposal;
  if (proposal !== null && proposal !== undefined && typeof proposal !== 'object') return null;
  const createdAt = whenIn(held.createdAt);
  if (createdAt === null) return null;
  return {
    id: held.id,
    ticketId: held.ticketId,
    answer: held.answer,
    sources: held.sources,
    decisionProposal: (proposal ?? null) as OutcomeProposal['decisionProposal'],
    author: held.author as Outcome['author'],
    sourceChatId: held.sourceChatId as string | null,
    createdAt,
  };
}

function asGlossaryList(body: unknown): GlossaryEntry[] | null {
  const entries = (body as { glossary?: unknown[] })?.glossary;
  if (!Array.isArray(entries)) return null;

  const read = entries.map(asGlossary);
  return read.some((entry) => entry === null) ? null : (read as GlossaryEntry[]);
}

function asGlossary(body: unknown): GlossaryEntry | null {
  const held = body as Partial<GlossaryEntry> | null;
  if (
    typeof held?.id !== 'string' ||
    typeof held.projectId !== 'string' ||
    typeof held.term !== 'string' ||
    typeof held.meaning !== 'string' ||
    !Array.isArray(held.wordsToAvoid) ||
    !held.wordsToAvoid.every((word) => typeof word === 'string') ||
    !Number.isInteger(held.version) ||
    typeof held.chatId !== 'string' ||
    !Array.isArray(held.history)
  ) {
    return null;
  }

  return held as GlossaryEntry;
}

/**
 * A worker's answer, as this desktop reads itself.
 *
 * `here` is true because the server answered at all: a body arriving is the whole
 * content of "it has heard from me", and the trouble that is not there is the absence
 * of one.
 */
function asStanding(body: unknown): WorkerStanding {
  const held = (body as { worker?: { name?: unknown } }).worker;

  return {
    name: typeof held?.name === 'string' ? held.name : '',
    here: true,
    trouble: null,
  };
}

/**
 * A run of a ticket, checked only for being one.
 *
 * The fields a window draws are read where they are drawn; what matters here is that a
 * run arrived at all, because every caller above has just asked for one.
 */
function asRun(body: unknown): TicketRun | null {
  const held = (body as { run?: { id?: unknown; ticketId?: unknown } }).run;
  if (typeof held?.id !== 'string' || typeof held.ticketId !== 'string') return null;

  return held as TicketRun;
}

/** One of a known set, or null when the server said something this build does not know. */
function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/**
 * One line of a run's transcript, checked for being one this build understands.
 *
 * `saidBy` is narrowed rather than trusted, because a window that drew an unknown
 * `saidBy` would be drawing a line from somebody it cannot name — and the alternative to
 * a line it cannot name is not a line at all.
 */
function asSaid(body: unknown): TicketSaid | null {
  const held = body as {
    id?: unknown;
    saidBy?: unknown;
    words?: unknown;
    at?: unknown;
  };
  const saidBy = oneOf(SAID_BY, held?.saidBy);
  const at = whenIn(held?.at);

  if (
    saidBy === null ||
    typeof held?.id !== 'string' ||
    typeof held.words !== 'string' ||
    at === null
  ) {
    return null;
  }

  return { id: held.id, saidBy, words: held.words, at };
}

/**
 * A timestamp as the server sent it, written down as the string a transcript line holds.
 *
 * The server writes an ISO string and Eden hands it back as a `Date`, because a treaty
 * revives dates on their way across. Both are accepted here and both come out as the
 * string the rest of the window reads — a narrowing that insisted on the string it saw in
 * the source refused every transcript line ever written, which is a thing only a live run
 * could have shown.
 */
function whenIn(value: unknown): string | null {
  if (typeof value === 'string') return value;

  return value instanceof Date ? value.toISOString() : null;
}

function asSaidList(body: unknown): TicketSaid[] | null {
  if (!Array.isArray(body)) return null;

  const lines = body.map(asSaid);

  return lines.some((each) => each === null) ? null : (lines as TicketSaid[]);
}

/** The person named in an answer from the server, if it named one. */
function userIn(answer: unknown): AuthUser | null {
  const user = (answer as { user?: unknown } | null)?.user;

  return isAuthUser(user) ? user : null;
}

/**
 * The sentence a refusal carries, if it carried one.
 *
 * A failed request comes back two ways, and both are read here: Eden hands it over
 * as `{ status, value }` — the status, and the body it parsed — while a refusal
 * written by hand is the envelope itself. Looking in only one of those places is
 * how a person ends up reading "that could not be saved" instead of the rule they
 * broke, which is the one thing a refusal is for.
 */
function messageIn(answer: unknown): string | null {
  const held = answer as {
    error?: { message?: unknown };
    value?: { error?: { message?: unknown } };
  } | null;
  const said = held?.error?.message ?? held?.value?.error?.message;

  return typeof said === 'string' && said !== '' ? said : null;
}
