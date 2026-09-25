/**
 * The tracker's own domain: projects, their tickets, the gate a ticket is at, and
 * the queue those derive.
 *
 * One relation, read from either end. A ticket names the tickets that gate it, so
 * its *children* are the tickets it names as gates — the parent names its slices,
 * which is what holds the parent out of the frontier until they land — and the
 * slices show the parent they hold up. There is no parent column and nothing stores
 * a tree (docs/adr/0017-a-ticket-is-one-object-with-children.md).
 *
 * Nothing here stores a band. A ticket's band is read off its closure, its gate,
 * whether its children are closed, whether anybody holds a claim on it, and how its
 * newest run ended, so a client cannot draw a state the server would not derive, and
 * the frontier a run is dispatched from is the same derivation (GH #57, #69, #71).
 *
 * A project is shared work. It is readable and writable by anyone signed in, and it
 * outlives the person who wrote it — authorship is cleared rather than cascaded, the
 * one place these tables diverge from the shape `usage` uses.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Database } from './database';
import { keyHolder, type HeldUser } from './keys';
import { refusal, REFUSAL } from './refusals';
import {
  claim,
  gate,
  outcome,
  project,
  run,
  ticket,
  transcript,
  user,
  worker,
  type OutcomeDecisionProposal,
} from './schema';

/** What a person can make of a run's proposal. Accepting also closes its ticket. */
const VERDICTS = ['accepted', 'sent-back'] as const;

/** What a ticket delivers, fixed when it is written. */
const KINDS = [
  'prototype',
  'bug',
  'feature',
  'refactor',
  'question',
  'research',
  'spec',
  'map',
] as const;

/** Where a ticket stands with whoever might resolve it. */
const GATES = ['draft', 'ready-for-agent', 'ready-for-human'] as const;

/** Why a ticket was closed. */
const CLOSURES = ['done', 'wontfix'] as const;

/** Who a line in a run's transcript came from. */
const SAID_BY = ['person', 'agent', 'note'] as const;

/**
 * A prefix: two to six characters, starting with a letter.
 *
 * Held uppercase, always, which is what makes the unique constraint a rule about
 * case as well as about spelling — `FND` and `fnd` cannot both exist, because only
 * one of them can (GH #57).
 */
const PREFIX = /^[A-Z][A-Z0-9]{1,5}$/;

/** How much of a title a branch name carries, so the name stays readable. */
const SLUG_LIMIT = 40;

const PROJECT = t.Object({
  id: t.String(),
  name: t.String(),
  prefix: t.String(),
});

/** A ticket at the other end of a gate, as a ticket's page draws it. */
const NAMED = t.Object({
  id: t.String(),
  name: t.String(),
  closed: t.Boolean(),
  closure: t.Union([t.String(), t.Null()]),
});

/** A claim on a ticket, as a client reads one. */
const CLAIM = t.Object({
  holder: t.Object({ id: t.String(), name: t.String() }),
  workerId: t.Union([t.String(), t.Null()]),
  startedAt: t.String(),
  heardAt: t.Union([t.String(), t.Null()]),
  leaseUntil: t.Union([t.String(), t.Null()]),
  /** Whether its lease has run out. A claim by hand has no lease, so it is never stale. */
  stale: t.Boolean(),
  /** How long since it was last heard from, or null when it has no heartbeat. */
  quietMs: t.Union([t.Integer(), t.Null()]),
});

/** A run as a client reads one. */
const RUN = t.Object({
  id: t.String(),
  ticketId: t.String(),
  workerId: t.Union([t.String(), t.Null()]),
  startedAt: t.String(),
  /** The criteria as they read when it started, copied rather than read through. */
  contract: t.Array(t.String()),
  branch: t.Union([t.String(), t.Null()]),
  endedAt: t.Union([t.String(), t.Null()]),
  stoppedBecause: t.Union([t.String(), t.Null()]),
  changed: t.Union([t.String(), t.Null()]),
  checks: t.Union([t.Array(t.String()), t.Null()]),
  made: t.Union([t.String(), t.Null()]),
  verdict: t.Union([t.String(), t.Null()]),
  verdictAt: t.Union([t.String(), t.Null()]),
});

const OUTCOME_DECISION = t.Object({
  context: t.String(),
  choice: t.String(),
  rejectedOptions: t.Array(t.String()),
  consequences: t.String(),
  supersedes: t.Union([t.String(), t.Null()]),
});
const OUTCOME = t.Object({
  id: t.String(),
  ticketId: t.String(),
  answer: t.String(),
  sources: t.Array(t.String()),
  decisionProposal: t.Union([OUTCOME_DECISION, t.Null()]),
  author: t.Union([t.Object({ id: t.String(), name: t.String() }), t.Null()]),
  sourceChatId: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
});
const OUTCOME_INPUT = t.Object({
  answer: t.String(),
  sources: t.Array(t.String()),
  sourceChatId: t.Optional(t.String()),
  decisionProposal: t.Optional(t.Union([OUTCOME_DECISION, t.Null()])),
});
const OUTCOME_INPUT_APPROVAL = t.Object({
  answer: t.String(),
  sources: t.Array(t.String()),
  sourceChatId: t.String(),
  decisionProposal: t.Optional(t.Union([OUTCOME_DECISION, t.Null()])),
});
const MAP_CHILD = t.Object({
  title: t.String(),
  body: t.String(),
  criteria: t.Array(t.String()),
});
const MAP_INPUT = t.Object({
  title: t.String(),
  body: t.String(),
  criteria: t.Array(t.String()),
  sourceChatId: t.Optional(t.String()),
  questions: t.Array(MAP_CHILD),
  research: t.Array(MAP_CHILD),
});
const DESTINATION_SPEC_INPUT = t.Object({
  title: t.String(),
  body: t.String(),
  criteria: t.Array(t.String()),
  sourceChatId: t.Optional(t.String()),
});
const TICKET = t.Object({
  id: t.String(),
  projectId: t.String(),
  name: t.String(),
  number: t.Integer(),
  kind: t.String(),
  title: t.String(),
  body: t.String(),
  criteria: t.Array(t.String()),
  gate: t.String(),
  band: t.String(),
  rank: t.Integer(),
  branch: t.String(),
  author: t.Union([t.Object({ id: t.String(), name: t.String() }), t.Null()]),
  gates: t.Array(NAMED),
  children: t.Array(NAMED),
  createdAt: t.String(),
  updatedAt: t.String(),
  closedAt: t.Union([t.String(), t.Null()]),
  closure: t.Union([t.String(), t.Null()]),
  sourceChatId: t.Union([t.String(), t.Null()]),
  claim: t.Union([CLAIM, t.Null()]),
  runs: t.Array(RUN),
  outcome: t.Union([OUTCOME, t.Null()]),
  /** Approved Outcomes from this map's closed question/research children. */
  decisionsSoFar: t.Array(OUTCOME),
});
const ONE_TICKET = t.Object({ ticket: TICKET });
const ONE_OUTCOME = t.Object({ outcome: OUTCOME });
const BREAKDOWN_CHILD = t.Object({
  id: t.String({ minLength: 1 }),
  kind: t.String(),
  title: t.String(),
  body: t.String(),
  criteria: t.Array(t.String()),
  dependsOn: t.Array(t.String()),
});
const BREAKDOWN = t.Object({ spec: TICKET, children: t.Array(TICKET) });
const ONE_RUN = t.Object({ run: RUN });

/** One thing said while a run went on. */
const SAID = t.Object({
  id: t.String(),
  saidBy: t.String(),
  words: t.String(),
  at: t.String(),
});

const ONE_SAID = t.Object({ said: SAID });
const TRANSCRIPT = t.Object({ transcript: t.Array(SAID) });

/** A row of the ticket table. */
type Row = typeof ticket.$inferSelect;
type RunRow = typeof run.$inferSelect;
type SaidRow = typeof transcript.$inferSelect;

/** A ticket at one end of a gate, as the read carries it. */
interface Named {
  id: string;
  name: string;
  closed: boolean;
  closure: string | null;
}

/** A claim on a ticket: who holds it, and what a worker's lease looks like. */
interface Held {
  holder: { id: string; name: string };
  workerId: string | null;
  startedAt: Date;
  heardAt: Date | null;
  leaseUntil: Date | null;
}

/** Everything the read of one ticket needs that is not on its own row. */
interface Context {
  author: { id: string; name: string } | null;
  gates: Named[];
  children: Named[];
  claim: Held | null;
  runs: RunRow[];
  outcome: OutcomeView | null;
  decisionsSoFar: OutcomeView[];
}

interface OutcomeView {
  id: string;
  ticketId: string;
  answer: string;
  sources: string[];
  decisionProposal: OutcomeDecisionProposal | null;
  author: { id: string; name: string } | null;
  sourceChatId: string | null;
  createdAt: Date;
}

export function createTickets({ auth, database }: { auth: Auth; database: Database }) {
  return new Elysia()
    .get(
      '/api/projects',
      async ({ request, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const heldProjects = await database
          .select()
          .from(project)
          .orderBy(asc(project.createdAt), asc(project.id));

        return { projects: heldProjects.map(asProject) };
      },
      {
        response: {
          200: t.Object({ projects: t.Array(PROJECT) }),
          401: REFUSAL,
        },
        detail: { summary: 'The projects anyone signed in may work in' },
      },
    )
    .post(
      '/api/projects',
      async ({ request, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const name = body.name.trim();
        if (name === '') {
          return status(400, refusal('NAME_REQUIRED', 'A project needs a name.'));
        }

        // Uppercased before it is judged, so `fnd` is the prefix `FND` rather than a
        // refusal about case — and a prefix somebody else already holds is refused
        // however it was typed.
        const prefix = body.prefix.trim().toUpperCase();
        if (!PREFIX.test(prefix)) {
          return status(
            400,
            refusal(
              'PREFIX_INVALID',
              'A prefix is two to six characters, starting with a letter: FND, A1B2C3.',
            ),
          );
        }

        const made = { id: randomUUID(), name, prefix, authorId: held.user.id };

        try {
          await database.insert(project).values(made);
        } catch (error) {
          if (postgresCode(error) === '23505') {
            return status(409, refusal('PREFIX_TAKEN', `Another project already holds ${prefix}.`));
          }
          throw error;
        }

        return { project: asProject({ ...made, createdAt: new Date() }) };
      },
      {
        body: t.Object({ name: t.String(), prefix: t.String() }),
        response: {
          200: t.Object({ project: PROJECT }),
          400: REFUSAL,
          401: REFUSAL,
          409: REFUSAL,
        },
        detail: {
          summary: 'Make a project, with the prefix its tickets are named under',
        },
      },
    )
    .get(
      '/api/projects/:ref',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const [found] = await database.select().from(project).where(eq(project.id, params.ref));
        if (!found) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        return await queue(database, found);
      },
      {
        params: t.Object({ ref: t.String() }),
        response: {
          200: t.Object({
            project: PROJECT,
            tickets: t.Array(TICKET),
            counts: t.Object({
              draft: t.Integer(),
              ready: t.Integer(),
              blocked: t.Integer(),
              done: t.Integer(),
              running: t.Integer(),
              'needs-you': t.Integer(),
            }),
          }),
          401: REFUSAL,
          404: REFUSAL,
        },
        detail: {
          summary: 'One project with its tickets, each in the band it is derived into',
        },
      },
    )
    .post(
      '/api/projects/:ref/tickets',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const [found] = await database.select().from(project).where(eq(project.id, params.ref));
        if (!found) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        if (!isOneOf(KINDS, body.kind)) {
          return status(400, refusal('KIND_UNKNOWN', `A ticket is one of ${KINDS.join(', ')}.`));
        }

        const written = await allocate(database, {
          projectId: found.id,
          kind: body.kind,
          title: body.title.trim(),
          body: body.body,
          criteria: body.criteria,
          gate: 'draft',
          authorId: held.user.id,
          sourceChatId: body.sourceChatId ?? null,
        });

        return { ticket: await one(database, found, written) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({
          kind: t.String(),
          title: t.String(),
          body: t.String(),
          criteria: t.Array(t.String()),
          sourceChatId: t.Optional(t.String()),
        }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Write a ticket down in a project, as a draft' },
      },
    )
    .post(
      '/api/projects/:ref/maps',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const [found] = await database.select().from(project).where(eq(project.id, params.ref));
        if (!found) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        const written = await database.transaction(async (transaction) => {
          const map = await allocate(transaction as unknown as Database, {
            projectId: found.id,
            kind: 'map',
            title: body.title.trim(),
            body: body.body,
            criteria: body.criteria,
            // An approved map is never agent work. Its first turn is the person/Kira
            // proposal that gathers the children, so it starts in the human gate.
            gate: 'ready-for-human',
            authorId: held.user.id,
            sourceChatId: body.sourceChatId ?? null,
          });

          for (const [kind, children] of [
            ['question', body.questions],
            ['research', body.research],
          ] as const) {
            for (const child of children) {
              const writtenChild = await allocate(transaction as unknown as Database, {
                projectId: found.id,
                kind,
                title: child.title.trim(),
                body: child.body,
                criteria: child.criteria,
                gate: kind === 'question' ? 'ready-for-human' : 'ready-for-agent',
                authorId: held.user.id,
                sourceChatId: null,
              });
              await transaction.insert(gate).values({
                ticketId: map.id,
                gatedById: writtenChild.id,
              });
            }
          }

          return map;
        });

        return { ticket: await one(database, found, written) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: MAP_INPUT,
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: {
          summary: 'Approve a map proposal and write its question and research children',
        },
      },
    )
    .post(
      '/api/tickets/:ref/destination-spec',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));
        if (found.ticket.kind !== 'map') {
          return status(400, refusal('MAP_REQUIRED', 'Only a map can receive a destination spec.'));
        }
        if (found.ticket.closedAt !== null) {
          return status(400, refusal('TICKET_CLOSED', 'A closed map already has its destination.'));
        }
        if (found.ticket.authorId !== held.user.id) {
          return status(
            403,
            refusal('MAP_NOT_YOURS', 'Only the person who approved the map may finish it.'),
          );
        }

        const children = await childrenOf(database, found.ticket.id);
        const childRows =
          children.length === 0
            ? []
            : await database
                .select()
                .from(ticket)
                .where(
                  inArray(
                    ticket.id,
                    children.map((each) => each.id),
                  ),
                );
        if (
          childRows.some((child) => child.kind !== 'question' && child.kind !== 'research') ||
          childRows.some((child) => child.closedAt === null) ||
          (
            await outcomesFor(
              database,
              childRows.map((child) => child.id),
            )
          ).size !== childRows.length
        ) {
          return status(
            400,
            refusal(
              'MAP_CHILDREN_OPEN',
              'A map needs every question and research child closed with an approved Outcome before its destination spec.',
            ),
          );
        }

        const written = await database.transaction(async (transaction) => {
          const spec = await allocate(transaction as unknown as Database, {
            projectId: found.project.id,
            kind: 'spec',
            title: body.title.trim(),
            body: body.body,
            criteria: body.criteria,
            // The destination follows the ordinary spec lifecycle: it is an
            // approved spec, ready for its breakdown, and an empty spec is blocked.
            gate: 'ready-for-agent',
            authorId: held.user.id,
            sourceChatId: body.sourceChatId ?? null,
          });
          await transaction.insert(gate).values({
            ticketId: found.ticket.id,
            gatedById: spec.id,
          });
          const closedAt = new Date();
          await transaction
            .update(ticket)
            .set({ closure: 'done', closedAt, updatedAt: closedAt })
            .where(eq(ticket.id, found.ticket.id));
          return spec;
        });

        return { ticket: await one(database, found.project, written) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: DESTINATION_SPEC_INPUT,
        response: {
          200: ONE_TICKET,
          400: REFUSAL,
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
        },
        detail: {
          summary: 'Approve a map destination spec and close the map atomically',
        },
      },
    )
    .post(
      '/api/tickets/:ref/breakdown',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));
        if (found.ticket.kind !== 'spec') {
          return status(400, refusal('BREAKDOWN_NOT_SPEC', 'Only a spec can publish a breakdown.'));
        }
        if ((await childrenOf(database, found.ticket.id)).length > 0) {
          return status(
            400,
            refusal('BREAKDOWN_ALREADY_PUBLISHED', 'That spec already has a breakdown.'),
          );
        }
        if (body.children.length === 0) {
          return status(
            400,
            refusal('BREAKDOWN_EMPTY', 'A breakdown needs at least one child ticket.'),
          );
        }

        const ids = new Set<string>();
        for (const child of body.children) {
          if (ids.has(child.id)) {
            return status(
              400,
              refusal('BREAKDOWN_DUPLICATE', 'A breakdown child id may only appear once.'),
            );
          }
          ids.add(child.id);
          if (!isOneOf(KINDS, child.kind)) {
            return status(400, refusal('KIND_UNKNOWN', `A ticket is one of ${KINDS.join(', ')}.`));
          }
          if (child.dependsOn.includes(child.id)) {
            return status(400, refusal('GATE_SELF', 'A ticket cannot gate itself.'));
          }
          if (
            child.dependsOn.some(
              (dependency) =>
                !ids.has(dependency) && !body.children.some((each) => each.id === dependency),
            )
          ) {
            return status(
              400,
              refusal(
                'BREAKDOWN_DEPENDENCY_UNKNOWN',
                'A breakdown dependency must name another proposed child.',
              ),
            );
          }
        }

        const dependencies = new Map(body.children.map((child) => [child.id, child.dependsOn]));
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const cycle = (id: string): boolean => {
          if (visiting.has(id)) return true;
          if (visited.has(id)) return false;
          visiting.add(id);
          for (const dependency of dependencies.get(id) ?? []) {
            if (cycle(dependency)) return true;
          }
          visiting.delete(id);
          visited.add(id);
          return false;
        };
        if (body.children.some((child) => cycle(child.id))) {
          return status(400, refusal('GATE_CIRCLE', 'That gate would close a circle of tickets.'));
        }

        const made: Row[] = [];
        const madeByProposal = new Map<string, Row>();
        await database.transaction(async (transaction) => {
          for (const child of body.children) {
            const written = await allocate(transaction as unknown as Database, {
              projectId: found.project.id,
              kind: child.kind,
              title: child.title.trim(),
              body: child.body,
              criteria: child.criteria,
              gate: 'draft',
              authorId: held.user.id,
              sourceChatId: null,
            });
            made.push(written);
            madeByProposal.set(child.id, written);
          }

          await transaction.insert(gate).values([
            ...made.map((child) => ({ ticketId: found.ticket.id, gatedById: child.id })),
            ...body.children.flatMap((child) =>
              child.dependsOn.map((dependency) => ({
                ticketId: madeByProposal.get(child.id)!.id,
                gatedById: madeByProposal.get(dependency)!.id,
              })),
            ),
          ]);
        });

        const children = await Promise.all(
          made.map(async (child) => one(database, found.project, child)),
        );
        return {
          spec: await one(database, found.project, found.ticket),
          children,
        };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({ children: t.Array(BREAKDOWN_CHILD) }),
        response: { 200: BREAKDOWN, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Publish a proposed spec breakdown as draft tickets' },
      },
    )
    .post(
      '/api/tickets/:ref/breakdown/ready',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));
        if (found.ticket.kind !== 'spec') {
          return status(
            400,
            refusal('BREAKDOWN_NOT_SPEC', 'Only a spec can mark its breakdown ready.'),
          );
        }

        const rows = await database
          .select({ child: ticket })
          .from(gate)
          .innerJoin(ticket, eq(ticket.id, gate.gatedById))
          .where(eq(gate.ticketId, found.ticket.id));
        if (rows.length === 0) {
          return status(
            400,
            refusal('BREAKDOWN_EMPTY', 'A breakdown needs at least one child ticket.'),
          );
        }
        if (rows.some(({ child }) => liveCriteria(child.criteria) === 0)) {
          return status(
            400,
            refusal(
              'CRITERIA_REQUIRED',
              'A ticket an agent runs has to say how it is known to be done.',
            ),
          );
        }

        const drafts = rows
          .filter(({ child }) => child.gate === 'draft')
          .map(({ child }) => child.id);
        if (drafts.length > 0) {
          await database.transaction(async (transaction) => {
            await transaction
              .update(ticket)
              .set({ gate: 'ready-for-agent', updatedAt: new Date() })
              .where(and(inArray(ticket.id, drafts), eq(ticket.gate, 'draft')));
          });
        }

        const currentRows = await database
          .select({ child: ticket })
          .from(gate)
          .innerJoin(ticket, eq(ticket.id, gate.gatedById))
          .where(eq(gate.ticketId, found.ticket.id));
        const children = await Promise.all(
          currentRows.map(async ({ child }) => one(database, found.project, child)),
        );
        return { spec: await one(database, found.project, found.ticket), children };
      },
      {
        params: t.Object({ ref: t.String() }),
        response: { 200: BREAKDOWN, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Mark every draft child in a spec breakdown ready' },
      },
    )
    .get(
      '/api/tickets/:ref',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));

        return { ticket: await one(database, found.project, found.ticket) };
      },
      {
        params: t.Object({ ref: t.String() }),
        response: { 200: ONE_TICKET, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'One ticket in full, by its id or by its name' },
      },
    )
    .post(
      '/api/tickets/:ref/question-chat',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));
        if (found.ticket.kind !== 'question') {
          return status(
            400,
            refusal('QUESTION_KIND_REQUIRED', 'Only a question has a linked Kira chat.'),
          );
        }
        if (found.ticket.authorId !== held.user.id) {
          return status(
            403,
            refusal('QUESTION_NOT_YOURS', 'Only the person who wrote the question may work it.'),
          );
        }
        if (found.ticket.closedAt !== null) {
          return status(
            400,
            refusal('TICKET_CLOSED', 'A closed question has already been settled.'),
          );
        }
        if (found.ticket.gate === 'draft') {
          return status(
            400,
            refusal('QUESTION_NOT_READY', 'A question is worked after it is ready.'),
          );
        }

        const chatId = found.ticket.sourceChatId ?? body.chatId?.trim() ?? randomUUID();
        if (chatId === '') {
          return status(400, refusal('CHAT_ID_REQUIRED', 'A question needs a linked Kira chat.'));
        }
        if (found.ticket.sourceChatId === null) {
          await database
            .update(ticket)
            .set({ sourceChatId: chatId, updatedAt: new Date() })
            .where(eq(ticket.id, found.ticket.id));
        }

        return {
          ticket: await one(database, found.project, {
            ...found.ticket,
            sourceChatId: chatId,
          }),
        };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({ chatId: t.Optional(t.String()) }),
        response: {
          200: ONE_TICKET,
          400: REFUSAL,
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
        },
        detail: {
          summary: 'Open or resume the one Kira chat that settles a question',
        },
      },
    )
    .get(
      '/api/tickets/:ref/outcome',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);
        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));
        const heldOutcome = await outcomeOn(database, found.ticket.id);
        if (heldOutcome === null)
          return status(404, refusal('OUTCOME_NOT_FOUND', 'No approved Outcome yet.'));
        return { outcome: asOutcomeValue(heldOutcome) };
      },
      {
        params: t.Object({ ref: t.String() }),
        response: { 200: ONE_OUTCOME, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Read the approved Outcome of a ticket' },
      },
    )
    .post(
      '/api/tickets/:ref/outcome',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);
        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));
        if (found.ticket.kind !== 'research') {
          return status(
            400,
            refusal('OUTCOME_RESEARCH_ONLY', 'Only research runs record an Outcome directly.'),
          );
        }
        const checked = outcomeInput(body);
        if ('refused' in checked) return status(400, checked.refused);
        if (found.ticket.authorId !== held.user.id) {
          return status(
            403,
            refusal(
              'OUTCOME_NOT_YOURS',
              'Only the person who wrote the research may record its Outcome.',
            ),
          );
        }
        if (
          found.ticket.closedAt !== null ||
          (await outcomeOn(database, found.ticket.id)) !== null
        ) {
          return status(
            400,
            refusal('OUTCOME_EXISTS', 'This ticket already has an approved Outcome.'),
          );
        }

        const made = madeOutcome(found.ticket.id, held.user.id, checked.value);
        await database.transaction(async (transaction) => {
          await transaction.insert(outcome).values(made);
          await transaction
            .update(ticket)
            .set({
              closure: 'done',
              closedAt: made.createdAt,
              updatedAt: made.createdAt,
            })
            .where(eq(ticket.id, found.ticket.id));
        });
        return { outcome: await asOutcome(database, made) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: OUTCOME_INPUT,
        response: {
          200: ONE_OUTCOME,
          400: REFUSAL,
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
        },
        detail: {
          summary: 'Record and close a research ticket with its Outcome',
        },
      },
    )
    .post(
      '/api/tickets/:ref/outcome/approve',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);
        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));
        if (found.ticket.kind !== 'question') {
          return status(
            400,
            refusal(
              'OUTCOME_QUESTION_ONLY',
              'Only a question Outcome is approved in a linked chat.',
            ),
          );
        }
        if (found.ticket.authorId !== held.user.id) {
          return status(
            403,
            refusal(
              'OUTCOME_NOT_YOURS',
              'Only the person who wrote the question may approve its Outcome.',
            ),
          );
        }
        if (found.ticket.sourceChatId === null || body.sourceChatId !== found.ticket.sourceChatId) {
          return status(
            400,
            refusal(
              'QUESTION_CHAT_REQUIRED',
              'Approve the Outcome from the question’s linked Kira chat.',
            ),
          );
        }
        const checked = outcomeInput(body);
        if ('refused' in checked) return status(400, checked.refused);
        if (
          found.ticket.closedAt !== null ||
          (await outcomeOn(database, found.ticket.id)) !== null
        ) {
          return status(
            400,
            refusal('OUTCOME_EXISTS', 'This ticket already has an approved Outcome.'),
          );
        }

        const made = madeOutcome(found.ticket.id, held.user.id, checked.value);
        await database.transaction(async (transaction) => {
          await transaction.insert(outcome).values(made);
          await transaction
            .update(ticket)
            .set({
              closure: 'done',
              closedAt: made.createdAt,
              updatedAt: made.createdAt,
            })
            .where(eq(ticket.id, found.ticket.id));
        });
        return { outcome: await asOutcome(database, made) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: OUTCOME_INPUT_APPROVAL,
        response: {
          200: ONE_OUTCOME,
          400: REFUSAL,
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
        },
        detail: {
          summary: 'Approve a question Outcome and close its ticket atomically',
        },
      },
    )
    .patch(
      '/api/tickets/:ref',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));

        if (body.gate !== undefined && !isOneOf(GATES, body.gate)) {
          return status(400, refusal('GATE_UNKNOWN', `A gate is one of ${GATES.join(', ')}.`));
        }
        if (body.closure !== undefined && !isOneOf(CLOSURES, body.closure)) {
          return status(
            400,
            refusal('CLOSURE_UNKNOWN', `A ticket is closed as ${CLOSURES.join(' or ')}.`),
          );
        }
        if (body.closure !== undefined && found.ticket.kind === 'map') {
          return status(
            400,
            refusal(
              'MAP_DESTINATION_REQUIRED',
              'A map closes only when its destination spec is approved.',
            ),
          );
        }
        if (
          body.closure !== undefined &&
          (found.ticket.kind === 'question' || found.ticket.kind === 'research') &&
          (await outcomeOn(database, found.ticket.id)) === null
        ) {
          return status(
            400,
            refusal(
              'OUTCOME_REQUIRED',
              'A question or research ticket needs an approved Outcome before it can close.',
            ),
          );
        }

        // The rule is checked against the ticket as it would be after this write, not
        // only on the transition that opens the gate: a contract handed to an agent
        // could otherwise be hollowed out one write at a time. `kind` is deliberately
        // not among the fields — it decides what a run owes (ADR 0011), so a ticket
        // written as the wrong kind is closed and written again.
        const after: Row = {
          ...found.ticket,
          title: body.title?.trim() ?? found.ticket.title,
          body: body.body ?? found.ticket.body,
          criteria: body.criteria ?? found.ticket.criteria,
          gate: body.gate ?? found.ticket.gate,
          rank: body.rank ?? found.ticket.rank,
        };

        if (after.gate === 'ready-for-agent' && liveCriteria(after.criteria) === 0) {
          return status(
            400,
            refusal(
              'CRITERIA_REQUIRED',
              'A ticket an agent runs has to say how it is known to be done.',
            ),
          );
        }

        const changed = {
          title: after.title,
          body: after.body,
          criteria: after.criteria,
          gate: after.gate,
          rank: after.rank,
          updatedAt: new Date(),
          ...(body.closure === undefined
            ? {}
            : {
                closure: body.closure,
                closedAt: after.closedAt ?? new Date(),
              }),
        };

        await database.update(ticket).set(changed).where(eq(ticket.id, found.ticket.id));

        return {
          ticket: await one(database, found.project, { ...after, ...changed }),
        };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({
          title: t.Optional(t.String()),
          body: t.Optional(t.String()),
          criteria: t.Optional(t.Array(t.String())),
          gate: t.Optional(t.String()),
          rank: t.Optional(t.Integer()),
          closure: t.Optional(t.String()),
        }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: {
          summary: 'Write what changed about a ticket: its body, gate, rank or closure',
        },
      },
    )
    .post(
      '/api/tickets/:ref/gates',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));

        const names = await resolve(database, body.gatedBy);
        if (!names) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket to gate on.'));

        const refused = await whyNot(database, found, names);
        if (refused) return status(400, refused);

        // Adding the same gate twice is the same gate: the table's primary key is the
        // pair, so this is the constraint doing the work rather than a read first.
        await database
          .insert(gate)
          .values({ ticketId: found.ticket.id, gatedById: names.ticket.id })
          .onConflictDoNothing();

        return { ticket: await one(database, found.project, found.ticket) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({ gatedBy: t.String() }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Name a ticket that gates this one' },
      },
    )
    .delete(
      '/api/tickets/:ref/gates/:gatedBy',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));

        const names = await resolve(database, params.gatedBy);

        if (names) {
          await database
            .delete(gate)
            .where(and(eq(gate.ticketId, found.ticket.id), eq(gate.gatedById, names.ticket.id)));
        }

        return { ticket: await one(database, found.project, found.ticket) };
      },
      {
        params: t.Object({ ref: t.String(), gatedBy: t.String() }),
        response: { 200: ONE_TICKET, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Take a gate off a ticket' },
      },
    )
    .post(
      '/api/tickets/:ref/claim',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));

        const refused = await whyNotClaimable(database, found, held.user);
        if (refused) return status(400, refused);

        const workerId = workerIn(body.workerId);
        const notThisDesk = await whyNotThisDesk(database, workerId, held.user);
        if (notThisDesk) return status(400, notThisDesk);

        // The read above can race with another worker doing the same thing, so the
        // primary key decides which insert landed — and the loser is refused rather
        // than answered with somebody else's claim.
        await database
          .insert(claim)
          .values({
            ticketId: found.ticket.id,
            holderId: held.user.id,
            workerId,
            heardAt: workerId === null ? null : new Date(),
            leaseUntil: workerId === null ? null : leaseFrom(body.leaseSeconds),
          })
          .onConflictDoNothing();

        const taken = await claimOn(database, found.ticket.id);
        if (taken === null || taken.holder.id !== held.user.id || taken.workerId !== workerId) {
          return status(400, refusal('CLAIM_TAKEN', 'Somebody is already working this ticket.'));
        }

        return { ticket: await one(database, found.project, found.ticket) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({
          workerId: t.Optional(t.Union([t.String(), t.Null()])),
          leaseSeconds: t.Optional(t.Number()),
        }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Take a ticket to work on it' },
      },
    )
    .post(
      '/api/tickets/:ref/claim/heartbeat',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));

        const taken = await claimOn(database, found.ticket.id);
        if (taken === null) {
          return status(400, refusal('CLAIM_NONE', 'Nobody is working this ticket.'));
        }

        // Only the desktop that holds a claim keeps it alive: another desktop of the
        // same person is a different hand, and a claim held by hand has no heartbeat.
        const workerId = workerIn(body.workerId);
        if (
          taken.holder.id !== held.user.id ||
          taken.workerId === null ||
          taken.workerId !== workerId
        ) {
          return status(
            400,
            refusal('CLAIM_NOT_HOLDER', 'This claim is not this desktop to keep alive.'),
          );
        }

        await database
          .update(claim)
          .set({
            heardAt: new Date(),
            leaseUntil: leaseFrom(body.leaseSeconds),
          })
          .where(eq(claim.ticketId, found.ticket.id));

        return { ticket: await one(database, found.project, found.ticket) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({
          workerId: t.Optional(t.Union([t.String(), t.Null()])),
          leaseSeconds: t.Optional(t.Number()),
        }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Say a claim is still being worked' },
      },
    )
    .post(
      '/api/tickets/:ref/claim/takeover',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));

        const taken = await claimOn(database, found.ticket.id);
        if (taken === null) {
          return status(400, refusal('CLAIM_NONE', 'Nobody is working this ticket.'));
        }

        // A claim whose lease is still good is being heard from. Taking one over is for
        // a worker that stopped answering, and never for work a clock decided to move.
        if (!isStale(taken)) {
          return status(400, refusal('CLAIM_NOT_STALE', 'That claim is still being heard from.'));
        }

        // Taking a claim over is for a desktop that stopped answering, so the run it was
        // driving lost its driver: it is ended here rather than left open, because a run
        // left open by a claim that changed hands is a ticket that can never run again.
        await lostItsDriver(
          database,
          found.ticket.id,
          'The desktop driving this run stopped answering.',
        );

        const workerId = workerIn(body.workerId);
        await database
          .update(claim)
          .set({
            holderId: held.user.id,
            workerId,
            startedAt: new Date(),
            heardAt: workerId === null ? null : new Date(),
            leaseUntil: workerId === null ? null : leaseFrom(body.leaseSeconds),
          })
          .where(eq(claim.ticketId, found.ticket.id));

        return { ticket: await one(database, found.project, found.ticket) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({
          workerId: t.Optional(t.Union([t.String(), t.Null()])),
          leaseSeconds: t.Optional(t.Number()),
        }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Take over a claim that stopped answering' },
      },
    )
    .delete(
      '/api/tickets/:ref/claim',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));

        const taken = await claimOn(database, found.ticket.id);
        if (taken !== null && taken.holder.id !== held.user.id) {
          return status(
            400,
            refusal('CLAIM_NOT_HOLDER', 'This ticket is somebody else to let go of.'),
          );
        }

        // Letting go of what nobody holds is the same as having let go of it.
        await lostItsDriver(database, found.ticket.id, 'Somebody let this run go.');
        await database.delete(claim).where(eq(claim.ticketId, found.ticket.id));

        return { ticket: await one(database, found.project, found.ticket) };
      },
      {
        params: t.Object({ ref: t.String() }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Let go of a ticket' },
      },
    )
    .post(
      '/api/tickets/:ref/runs',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', 'No such ticket.'));

        const workerId = workerIn(body.workerId);
        const taken = await claimOn(database, found.ticket.id);
        const refused = whyNotRunnable(taken, held.user, workerId);
        if (refused) return status(400, refused);

        const open = (await runsFor(database, [found.ticket.id])).get(found.ticket.id) ?? [];
        if (open.some((each) => each.endedAt === null)) {
          return status(400, refusal('RUN_OPEN', 'That ticket is already being run.'));
        }

        // The contract is copied rather than read through, so what this run verified
        // cannot be rewritten under it by editing the ticket (GH #57).
        const made: RunRow = {
          id: randomUUID(),
          ticketId: found.ticket.id,
          driverId: held.user.id,
          workerId,
          startedAt: new Date(),
          contract: found.ticket.criteria,
          branch: null,
          endedAt: null,
          stoppedBecause: null,
          changed: null,
          checks: null,
          made: null,
          verdict: null,
          verdictAt: null,
        };
        await database.insert(run).values(made);

        return { run: asRun(made) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({
          workerId: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        response: { 200: ONE_RUN, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Start a run on a ticket somebody has claimed' },
      },
    )
    .patch(
      '/api/tickets/:ref/runs/:runId',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await runOn(database, params.ref, params.runId);
        if (!found) return status(404, refusal('RUN_NOT_FOUND', 'No such run.'));

        const refused = whyNotTheirs(found.run, held.user);
        if (refused) return status(400, refused);

        if (found.run.endedAt !== null) {
          return status(400, refusal('RUN_ENDED', 'That run has already ended.'));
        }

        const after: RunRow = {
          ...found.run,
          branch: textIn(body.branch) ?? found.run.branch,
        };
        await database.update(run).set({ branch: after.branch }).where(eq(run.id, found.run.id));

        return { run: asRun(after) };
      },
      {
        params: t.Object({ ref: t.String(), runId: t.String() }),
        body: t.Object({ branch: t.Optional(t.Union([t.String(), t.Null()])) }),
        response: { 200: ONE_RUN, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Say what a run has made so far' },
      },
    )
    .post(
      '/api/tickets/:ref/runs/:runId/end',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await runOn(database, params.ref, params.runId);
        if (!found) return status(404, refusal('RUN_NOT_FOUND', 'No such run.'));

        const refused = whyNotTheirs(found.run, held.user);
        if (refused) return status(400, refused);

        if (found.run.endedAt !== null) {
          return status(400, refusal('RUN_ENDED', 'That run has already ended.'));
        }

        const after: RunRow = {
          ...found.run,
          endedAt: new Date(),
          changed: textIn(body.changed),
          checks: Array.isArray(body.checks) ? body.checks.filter(isText) : null,
          made: textIn(body.made),
          stoppedBecause: textIn(body.stoppedBecause),
        };
        await database
          .update(run)
          .set({
            endedAt: after.endedAt,
            changed: after.changed,
            checks: after.checks,
            made: after.made,
            stoppedBecause: after.stoppedBecause,
          })
          .where(eq(run.id, found.run.id));

        // A run that has ended is a ticket nobody is working any more, so the claim goes
        // with it and the ticket can be claimed again.
        await database.delete(claim).where(eq(claim.ticketId, found.ticket.id));

        return { run: asRun(after) };
      },
      {
        params: t.Object({ ref: t.String(), runId: t.String() }),
        body: t.Object({
          changed: t.Optional(t.Union([t.String(), t.Null()])),
          checks: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
          made: t.Optional(t.Union([t.String(), t.Null()])),
          stoppedBecause: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        response: { 200: ONE_RUN, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'End a run, with what it made' },
      },
    )
    .post(
      '/api/tickets/:ref/runs/:runId/verdict',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await runOn(database, params.ref, params.runId);
        if (!found) return status(404, refusal('RUN_NOT_FOUND', 'No such run.'));

        const refused = whyNotTheirs(found.run, held.user);
        if (refused) return status(400, refused);

        // The value first, so a verdict that is not one of the two is refused as itself
        // rather than as a run that has already been judged.
        if (!isOneOf(VERDICTS, body.verdict)) {
          return status(400, refusal('VERDICT_UNKNOWN', 'A verdict is accepted or sent back.'));
        }

        if (found.run.endedAt === null) {
          return status(400, refusal('RUN_UNFINISHED', 'That run has not ended yet.'));
        }

        if (found.run.verdict !== null) {
          return status(400, refusal('RUN_JUDGED', 'That run has already been judged.'));
        }

        const judgedAt = new Date();
        const after: RunRow = {
          ...found.run,
          verdict: body.verdict,
          verdictAt: judgedAt,
        };

        // Acceptance is one decision: either its verdict and the ticket's Done closure
        // land together, or neither does. A sent-back run only records the verdict, so
        // the open ticket can be claimed for another attempt.
        await database.transaction(async (transaction) => {
          await transaction
            .update(run)
            .set({ verdict: after.verdict, verdictAt: after.verdictAt })
            .where(eq(run.id, found.run.id));

          if (after.verdict === 'accepted') {
            await transaction
              .update(ticket)
              .set({ closure: 'done', closedAt: judgedAt, updatedAt: judgedAt })
              .where(eq(ticket.id, found.ticket.id));
          }
        });

        return { run: asRun(after) };
      },
      {
        params: t.Object({ ref: t.String(), runId: t.String() }),
        body: t.Object({ verdict: t.String() }),
        response: { 200: ONE_RUN, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: "Say what you make of a run's proposal" },
      },
    )
    .get(
      '/api/tickets/:ref/runs/:runId/transcript',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await runOn(database, params.ref, params.runId);
        if (!found) return status(404, refusal('RUN_NOT_FOUND', 'No such run.'));

        return { transcript: await saidIn(database, found.run.id) };
      },
      {
        params: t.Object({ ref: t.String(), runId: t.String() }),
        response: { 200: TRANSCRIPT, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'What was said while a run went on' },
      },
    )
    .post(
      '/api/tickets/:ref/runs/:runId/transcript',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await runOn(database, params.ref, params.runId);
        if (!found) return status(404, refusal('RUN_NOT_FOUND', 'No such run.'));

        const refused = whyNotTheirs(found.run, held.user);
        if (refused) return status(400, refused);

        if (!isOneOf(SAID_BY, body.saidBy)) {
          return status(
            400,
            refusal('SAID_BY_UNKNOWN', `A transcript line is ${SAID_BY.join(', ')}.`),
          );
        }
        if (body.words.trim() === '') {
          return status(400, refusal('SAID_NOTHING', 'A transcript line says something.'));
        }

        // Written once and never changed: a transcript somebody can edit afterwards is
        // not a record of what happened. An entry may be written after the run has ended,
        // because the last thing a run says is usually why it stopped.
        const wrote: SaidRow = {
          id: randomUUID(),
          runId: found.run.id,
          saidBy: body.saidBy,
          words: body.words,
          at: new Date(),
        };
        await database.insert(transcript).values(wrote);

        return { said: asSaid(wrote) };
      },
      {
        params: t.Object({ ref: t.String(), runId: t.String() }),
        body: t.Object({ saidBy: t.String(), words: t.String() }),
        response: { 200: ONE_SAID, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Write down what was said in a run' },
      },
    );
}

/**
 * The person a request is from, or the refusal to answer it with.
 *
 * Three ways of not being signed in arrive here — no key at all, a key nobody
 * holds, and a key whose person is gone — and all three are answered as themselves
 * rather than as an empty queue. An empty queue is what "this project has no work"
 * looks like, and a broken sign-in must never be mistaken for one.
 */
type Asking = { readonly refused: ReturnType<typeof refusal> } | { readonly user: HeldUser };

async function asking(auth: Auth, request: Request): Promise<Asking> {
  const held = await keyHolder(auth, request);
  if ('refusal' in held) return { refused: refusal(held.refusal.code, held.refusal.message) };

  return { user: held.user };
}

/**
 * A project with all of its tickets, each in the band it is derived into.
 *
 * Six queries whatever the size of the queue — the tickets, their gates, their
 * authors, their claims, their runs, and the project itself — because a queue is read
 * every time somebody looks at it, and a read per ticket is a queue that gets slower as
 * it fills up.
 */
async function queue(database: Database, held: typeof project.$inferSelect) {
  const rows = await database
    .select()
    .from(ticket)
    .where(eq(ticket.projectId, held.id))
    .orderBy(asc(ticket.rank), asc(ticket.number));

  const edges =
    rows.length === 0
      ? []
      : await edgesFor(
          database,
          rows.map((each) => each.id),
        );
  const authors = await authorsOf(database, rows);
  const claims = await claimsFor(
    database,
    rows.map((each) => each.id),
  );
  const runs = await runsFor(
    database,
    rows.map((each) => each.id),
  );
  const outcomes = await outcomesFor(
    database,
    rows.map((each) => each.id),
  );
  const named = new Map<string, Named>(rows.map((row) => [row.id, asNamed(row, held.prefix)]));

  const tickets = rows.map((row) =>
    asTicket(row, held.prefix, {
      author: row.authorId === null ? null : (authors.get(row.authorId) ?? null),
      claim: claims.get(row.id) ?? null,
      runs: runs.get(row.id) ?? [],
      outcome: outcomes.get(row.id) ?? null,
      decisionsSoFar:
        row.kind === 'map'
          ? edges
              .filter((each) => each.ticketId === row.id)
              .map((each) => outcomes.get(each.gatedById))
              .filter(isThere)
          : [],
      gates: edges
        .filter((each) => each.gatedById === row.id)
        .map((each) => named.get(each.ticketId))
        .filter(isThere),
      children: edges
        .filter((each) => each.ticketId === row.id)
        .map((each) => named.get(each.gatedById))
        .filter(isThere),
    }),
  );

  return {
    project: asProject(held),
    tickets,
    counts: {
      draft: bandCount(tickets, 'draft'),
      ready: bandCount(tickets, 'ready'),
      blocked: bandCount(tickets, 'blocked'),
      done: bandCount(tickets, 'done'),
      running: bandCount(tickets, 'running'),
      'needs-you': bandCount(tickets, 'needs-you'),
    },
  };
}

/** One ticket in full, read the long way round because it is one ticket. */
async function one(database: Database, held: typeof project.$inferSelect, row: Row) {
  const edges = await edgesFor(database, [row.id]);
  const touched = new Set(edges.flatMap((each) => [each.ticketId, each.gatedById]));
  const relates =
    touched.size === 0
      ? []
      : await database
          .select()
          .from(ticket)
          .where(inArray(ticket.id, [...touched]));

  const named = new Map<string, Named>(
    relates.map((each) => [each.id, asNamed(each, held.prefix)]),
  );
  const authors = await authorsOf(database, [row]);
  const childOutcomes =
    row.kind === 'map'
      ? await outcomesFor(
          database,
          edges.filter((each) => each.ticketId === row.id).map((each) => each.gatedById),
        )
      : new Map<string, OutcomeView>();

  return asTicket(row, held.prefix, {
    author: row.authorId === null ? null : (authors.get(row.authorId) ?? null),
    claim: await claimOn(database, row.id),
    runs: (await runsFor(database, [row.id])).get(row.id) ?? [],
    outcome: await outcomeOn(database, row.id),
    decisionsSoFar:
      row.kind === 'map'
        ? edges
            .filter((each) => each.ticketId === row.id)
            .map((each) => childOutcomes.get(each.gatedById))
            .filter(isThere)
        : [],
    gates: edges
      .filter((each) => each.gatedById === row.id)
      .map((each) => named.get(each.ticketId))
      .filter(isThere),
    children: edges
      .filter((each) => each.ticketId === row.id)
      .map((each) => named.get(each.gatedById))
      .filter(isThere),
  });
}

/**
 * Which project and ticket a reference names: an id, or the name people say.
 *
 * A name is the project's prefix and a number — `FND-12` — and it is resolved
 * rather than stored so that a name in a chat is openable.
 */
async function resolve(database: Database, ref: string) {
  const [byId] = await database.select().from(ticket).where(eq(ticket.id, ref));
  if (byId) {
    const [held] = await database.select().from(project).where(eq(project.id, byId.projectId));
    return held ? { project: held, ticket: byId } : null;
  }

  const said = /^([a-z0-9]{2,6})-(\d+)$/i.exec(ref.trim());
  if (!said) return null;

  const [held] = await database
    .select()
    .from(project)
    .where(eq(project.prefix, said[1]!.toUpperCase()));
  if (!held) return null;

  const [found] = await database
    .select()
    .from(ticket)
    .where(and(eq(ticket.projectId, held.id), eq(ticket.number, Number(said[2]!))));

  return found ? { project: held, ticket: found } : null;
}

/**
 * Why a gate cannot be added, or null when it can.
 *
 * All three are refused before anything is written, so a refused edge leaves no
 * partial row: a ticket may not gate itself, a gate may only name a ticket in the
 * same project, and the edge may not close a circle. A circle is not a hard case to
 * get right — it is a queue that can never empty, because nothing in it is ever
 * ready.
 */
async function whyNot(
  database: Database,
  held: { project: typeof project.$inferSelect; ticket: Row },
  names: { project: typeof project.$inferSelect; ticket: Row },
) {
  if (names.ticket.id === held.ticket.id) {
    return refusal('GATE_SELF', 'A ticket cannot gate itself.');
  }
  if (names.project.id !== held.project.id) {
    return refusal(
      'GATE_OTHER_PROJECT',
      'A ticket may only be gated by another ticket in the same project.',
    );
  }

  // Walking down from the ticket being named: if this ticket is reachable from it,
  // the edge would close a ring.
  const seen = new Set<string>([names.ticket.id]);
  let front = [names.ticket.id];

  while (front.length > 0) {
    const edges = await edgesFor(database, front);
    const next = edges
      .filter((each) => each.ticketId !== each.gatedById)
      .map((each) => each.gatedById)
      .filter((each) => !seen.has(each));

    if (next.includes(held.ticket.id)) {
      return refusal('GATE_CIRCLE', 'That gate would close a circle of tickets.');
    }

    for (const each of next) seen.add(each);
    front = next;
  }

  return null;
}

/** The gate edges of these tickets, both ways round. */
function edgesFor(database: Database, ids: string[]) {
  return database
    .select()
    .from(gate)
    .where(inArray(gate.ticketId, ids))
    .then(async (down) => [
      ...down,
      ...(await database.select().from(gate).where(inArray(gate.gatedById, ids))),
    ])
    .then((both) => [
      ...new Map(both.map((each) => [`${each.ticketId}:${each.gatedById}`, each])).values(),
    ]);
}

/** The author of each of these tickets, asked once for all of them. */
async function authorsOf(database: Database, rows: Row[]) {
  const ids = [...new Set(rows.map((each) => each.authorId).filter(isText))];
  if (ids.length === 0) return new Map<string, { id: string; name: string }>();

  const people = await database
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, ids));

  return new Map(people.map((each) => [each.id, each]));
}

type OutcomeRow = typeof outcome.$inferSelect;

type OutcomeInput = {
  answer: string;
  sources: string[];
  sourceChatId: string | null;
  decisionProposal: OutcomeDecisionProposal | null;
};

const OUTCOME_REQUIRED = 'A question or research ticket needs an answer and supporting sources.';

function outcomeInput(
  value: unknown,
): { value: OutcomeInput } | { refused: ReturnType<typeof refusal> } {
  if (typeof value !== 'object' || value === null) {
    return { refused: refusal('OUTCOME_INVALID', OUTCOME_REQUIRED) };
  }
  const held = value as Record<string, unknown>;
  const answer = typeof held.answer === 'string' ? held.answer.trim() : '';
  const sources = Array.isArray(held.sources)
    ? held.sources
        .filter((source): source is string => typeof source === 'string')
        .map((source) => source.trim())
    : [];
  if (answer === '' || sources.length === 0 || sources.some((source) => source === '')) {
    return { refused: refusal('OUTCOME_REQUIRED', OUTCOME_REQUIRED) };
  }

  const raw = held.decisionProposal;
  let decisionProposal: OutcomeDecisionProposal | null = null;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'object') {
      return {
        refused: refusal(
          'DECISION_PROPOSAL_INVALID',
          'A Decision proposal needs structured context and consequences.',
        ),
      };
    }
    const proposal = raw as Record<string, unknown>;
    if (
      typeof proposal.context !== 'string' ||
      proposal.context.trim() === '' ||
      typeof proposal.choice !== 'string' ||
      proposal.choice.trim() === '' ||
      !Array.isArray(proposal.rejectedOptions) ||
      !proposal.rejectedOptions.every(
        (option) => typeof option === 'string' && option.trim() !== '',
      ) ||
      typeof proposal.consequences !== 'string' ||
      proposal.consequences.trim() === '' ||
      (proposal.supersedes !== null && typeof proposal.supersedes !== 'string')
    ) {
      return {
        refused: refusal(
          'DECISION_PROPOSAL_INVALID',
          'A Decision proposal needs structured context and consequences.',
        ),
      };
    }
    decisionProposal = {
      context: proposal.context.trim(),
      choice: proposal.choice.trim(),
      rejectedOptions: (proposal.rejectedOptions as string[]).map((option) => option.trim()),
      consequences: proposal.consequences.trim(),
      supersedes: proposal.supersedes as string | null,
    };
  }

  return {
    value: {
      answer,
      sources,
      sourceChatId: typeof held.sourceChatId === 'string' ? held.sourceChatId : null,
      decisionProposal,
    },
  };
}

function madeOutcome(ticketId: string, authorId: string, input: OutcomeInput): OutcomeRow {
  return {
    id: randomUUID(),
    ticketId,
    answer: input.answer,
    sources: input.sources,
    decisionProposal: input.decisionProposal,
    authorId,
    sourceChatId: input.sourceChatId,
    createdAt: new Date(),
  };
}

async function outcomesFor(database: Database, ids: string[]): Promise<Map<string, OutcomeView>> {
  if (ids.length === 0) return new Map();
  const rows = await database.select().from(outcome).where(inArray(outcome.ticketId, ids));
  const people = await database
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, rows.map((row) => row.authorId).filter(isText)));
  const authors = new Map(people.map((person) => [person.id, person]));
  return new Map(
    rows.map((row) => [
      row.ticketId,
      {
        ...row,
        author: row.authorId === null ? null : (authors.get(row.authorId) ?? null),
      } as OutcomeView,
    ]),
  );
}

async function outcomeOn(database: Database, ticketId: string): Promise<OutcomeView | null> {
  const rows = await outcomesFor(database, [ticketId]);
  return rows.get(ticketId) ?? null;
}

async function asOutcome(database: Database, row: OutcomeRow) {
  const people =
    row.authorId === null
      ? []
      : await database
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(eq(user.id, row.authorId));
  return asOutcomeValue({
    ...row,
    author: row.authorId === null ? null : (people[0] ?? null),
  } as OutcomeView);
}

function asOutcomeValue(row: OutcomeView) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    answer: row.answer,
    sources: row.sources,
    decisionProposal: row.decisionProposal,
    author: row.author,
    sourceChatId: row.sourceChatId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Write a ticket down, drawing its number and its place in the queue.
 *
 * Two tickets written at the same moment both have to succeed, so a number that
 * collides is retried here rather than surfaced: a uniqueness error is not
 * something a person writing a ticket can act on. The number is never reused —
 * nothing frees one — so the next ticket always follows the highest.
 */
async function allocate(
  database: Database,
  written: {
    projectId: string;
    kind: string;
    title: string;
    body: string;
    criteria: string[];
    gate: string;
    authorId: string;
    sourceChatId: string | null;
  },
) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const [highest] = await database
      .select({
        number: sql<number>`coalesce(max(${ticket.number}), 0)`,
        rank: sql<number>`coalesce(max(${ticket.rank}), 0)`,
      })
      .from(ticket)
      .where(eq(ticket.projectId, written.projectId));

    const row: Row = {
      id: randomUUID(),
      ...written,
      number: Number(highest?.number ?? 0) + 1,
      rank: Number(highest?.rank ?? 0) + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      closedAt: null,
      closure: null,
    };

    try {
      await database.insert(ticket).values(row);
      return row;
    } catch (error) {
      if (postgresCode(error) !== '23505') throw error;
    }
  }

  throw new Error('could not draw a ticket number');
}

/**
 * The claims on a set of tickets, in one query.
 *
 * A queue is read every time somebody looks at it, so the claims come back with the
 * tickets rather than one query each — and the holder's name comes with them, because
 * the surface says who is working a ticket rather than which id holds it.
 */
async function claimsFor(database: Database, ids: string[]): Promise<Map<string, Held>> {
  if (ids.length === 0) return new Map();

  const rows = await database
    .select({ held: claim, name: user.name })
    .from(claim)
    .innerJoin(user, eq(user.id, claim.holderId))
    .where(inArray(claim.ticketId, ids));

  return new Map(
    rows.map((each) => [
      each.held.ticketId,
      {
        holder: { id: each.held.holderId, name: each.name },
        workerId: each.held.workerId,
        startedAt: each.held.startedAt,
        heardAt: each.held.heardAt,
        leaseUntil: each.held.leaseUntil,
      },
    ]),
  );
}

/** The claim on one ticket, or null when nobody holds it. */
async function claimOn(database: Database, id: string): Promise<Held | null> {
  return (await claimsFor(database, [id])).get(id) ?? null;
}

/**
 * The tickets this one names as its gates, as the band derivation reads them.
 *
 * The band needs them and nothing else does, so this is the one read that asks for a
 * single ticket's children rather than a queue's edges.
 */
async function childrenOf(database: Database, id: string): Promise<Named[]> {
  const rows = await database
    .select({ child: ticket, prefix: project.prefix })
    .from(gate)
    .innerJoin(ticket, eq(ticket.id, gate.gatedById))
    .innerJoin(project, eq(project.id, ticket.projectId))
    .where(eq(gate.ticketId, id))
    .orderBy(asc(ticket.rank), asc(ticket.number));

  return rows.map((each) => asNamed(each.child, each.prefix));
}

/**
 * Why this ticket may not be claimed by this person, or null when it may.
 *
 * Three rules in the order a person would say them: it has to be for the person
 * asking, because only the person a ticket is for starts a run of it and a run spends
 * their allowance (docs/adr/0013); it has to be nobody else's; and it has to be ready
 * to be run at all.
 */
async function whyNotClaimable(
  database: Database,
  found: { project: typeof project.$inferSelect; ticket: Row },
  who: HeldUser,
): Promise<ReturnType<typeof refusal> | null> {
  if (found.ticket.authorId !== who.id) {
    return refusal('CLAIM_NOT_YOURS', 'A ticket is run by the person it is for.');
  }

  if ((await claimOn(database, found.ticket.id)) !== null) {
    return refusal('CLAIM_TAKEN', 'Somebody is already working this ticket.');
  }

  const children = await childrenOf(database, found.ticket.id);
  if (bandOf(found.ticket, children, null, []) !== 'ready') {
    return refusal('CLAIM_NOT_READY', 'A ticket is worked when it is ready and nothing else.');
  }

  return null;
}

/**
 * Why this claim may not name this desktop, or null when it may.
 *
 * A claim that names a desktop says which machine is doing the work, so it has to name
 * one that has offered itself and belongs to the person asking. Without this a claim can
 * be written against a machine that was never heard of, which reads as work being done by
 * nothing and can never be refreshed by a heartbeat (GH #68).
 */
async function whyNotThisDesk(
  database: Database,
  workerId: string | null,
  who: HeldUser,
): Promise<ReturnType<typeof refusal> | null> {
  if (workerId === null) return null;

  const [offered] = await database
    .select({ ownerId: worker.ownerId })
    .from(worker)
    .where(eq(worker.id, workerId))
    .limit(1);

  if (offered === undefined) {
    return refusal('CLAIM_NO_WORKER', 'That desktop has not offered itself as a worker.');
  }

  if (offered.ownerId !== who.id) {
    return refusal('CLAIM_WORKER_NOT_YOURS', "That desktop is somebody else's to work from.");
  }

  return null;
}

/** A claim as a client reads it, with its staleness read off the clock at read time. */
function asClaim(held: Held) {
  const quietSince = held.heardAt ?? held.startedAt;

  return {
    holder: held.holder,
    workerId: held.workerId,
    startedAt: held.startedAt.toISOString(),
    heardAt: held.heardAt?.toISOString() ?? null,
    leaseUntil: held.leaseUntil?.toISOString() ?? null,
    stale: isStale(held),
    quietMs: held.leaseUntil === null ? null : Math.max(0, Date.now() - quietSince.getTime()),
  };
}

/**
 * Whether a claim's lease has run out.
 *
 * A claim held by hand has no lease, so it is never stale: there is nothing that could
 * have stopped answering, and taking it over is a hand's decision whenever a hand
 * decides to make it.
 */
function isStale(held: Held): boolean {
  return held.leaseUntil !== null && held.leaseUntil.getTime() <= Date.now();
}

/**
 * The run a claim was carrying, ended because the driver it was riding on is gone.
 *
 * A claim and a run are two halves of one thing: the claim is what takes the ticket off
 * the queue, and the run is what it is off the queue for. Let the claim go — or hand it to
 * somebody else — and leave the run open, and the ticket lands in the one state nothing
 * gets out of: Ready to a person, refused to Run because a run is already going, with no
 * window able to end a run nobody is driving (GH #68, #75). A run that ended on its own
 * terms keeps them, so this only ever touches one that never ended.
 */
export async function lostItsDriver(
  database: Database,
  ticketId: string,
  because: string,
): Promise<void> {
  await database
    .update(run)
    .set({ endedAt: new Date(), stoppedBecause: because })
    .where(and(eq(run.ticketId, ticketId), isNull(run.endedAt)));
}

/**
 * When a claim's lease runs out, counted from now.
 *
 * A worker sends how long it wants, within an hour: long enough that a run which is
 * working does not have to be chatty, short enough that a desktop which vanished is
 * visibly quiet within a coffee break rather than a day. Two things hear from a holder —
 * the claim's own heartbeat, and the worker saying it is still here — and both count the
 * lease the same way, so a claim means "the machine went away" rather than "a minute
 * passed" (GH #69, #74).
 */
export function leaseFrom(seconds: unknown): Date {
  const wanted = typeof seconds === 'number' && Number.isFinite(seconds) ? Math.floor(seconds) : 60;

  return new Date(Date.now() + Math.min(Math.max(wanted, 0), 3600) * 1000);
}

/** The desktop a claim is from, or null when a person is working it by hand. */
function workerIn(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Something a run said, or null when it said nothing about it. */
function textIn(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * The branch a ticket is on: the one its newest run made, or the name it would derive.
 *
 * Recording the branch closes the limit a derived name carries: a retitle changes the
 * name a branch would get, and says nothing about a branch that already exists. So a
 * ticket shows the branch there is as soon as a run has made one (GH #64, #70).
 */
function branchOf(row: Row, prefix: string, runs: RunRow[]): string {
  const made = runs.find((each) => each.branch !== null)?.branch;

  return made ?? branchFor(prefix, row.number, row.title);
}

/** A run as a client reads it. */
function asRun(row: RunRow) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    workerId: row.workerId,
    startedAt: row.startedAt.toISOString(),
    contract: row.contract,
    branch: row.branch,
    endedAt: row.endedAt?.toISOString() ?? null,
    stoppedBecause: row.stoppedBecause,
    changed: row.changed,
    checks: row.checks,
    made: row.made,
    verdict: row.verdict,
    verdictAt: row.verdictAt?.toISOString() ?? null,
  };
}

/** A run's transcript, oldest first, which is the order it was said in. */
async function saidIn(database: Database, runId: string) {
  const rows = await database
    .select()
    .from(transcript)
    .where(eq(transcript.runId, runId))
    .orderBy(asc(transcript.at), asc(transcript.id));

  return rows.map(asSaid);
}

/** A line of a run's transcript as a client reads it. */
function asSaid(row: SaidRow) {
  return {
    id: row.id,
    saidBy: row.saidBy,
    words: row.words,
    at: row.at.toISOString(),
  };
}

/**
 * The runs of a set of tickets, newest first, in one query.
 *
 * Newest first because that is the order a ticket's page reads them in and the order
 * "what happened last" is answered from, and in one query because a queue carries every
 * ticket's runs rather than fetching them one at a time.
 */
async function runsFor(database: Database, ids: string[]): Promise<Map<string, RunRow[]>> {
  if (ids.length === 0) return new Map();

  const rows = await database
    .select()
    .from(run)
    .where(inArray(run.ticketId, ids))
    .orderBy(desc(run.startedAt), desc(run.id));

  const grouped = new Map<string, RunRow[]>();
  for (const row of rows) {
    grouped.set(row.ticketId, [...(grouped.get(row.ticketId) ?? []), row]);
  }

  return grouped;
}

/** One run, and the ticket it is a run of. */
async function runOn(database: Database, ref: string, runId: string) {
  const found = await resolve(database, ref);
  if (!found) return null;

  const [held] = await database
    .select()
    .from(run)
    .where(and(eq(run.id, runId), eq(run.ticketId, found.ticket.id)));

  return held === undefined ? null : { ...found, run: held };
}

/**
 * Why a ticket may not be run by this hand, or null when it may.
 *
 * A run happens on a claim: a ticket nobody holds is one nobody has started, and a
 * claim held by another desktop is another hand's to run. Only the person a ticket is
 * for starts a run of it, and a run spends their allowance (docs/adr/0012, 0013).
 */
function whyNotRunnable(
  taken: Held | null,
  who: HeldUser,
  workerId: string | null,
): ReturnType<typeof refusal> | null {
  if (taken === null) {
    return refusal('CLAIM_NONE', 'A run happens on a ticket somebody has claimed.');
  }

  if (taken.holder.id !== who.id || taken.workerId !== workerId) {
    return refusal('CLAIM_NOT_HOLDER', 'This ticket is somebody else to work.');
  }

  return null;
}

/**
 * Why this run may not be written by this person, or null when it may.
 *
 * The driver of a run is the person whose claim it happens on, so what a run reports
 * about itself is theirs to report and nobody else's (docs/adr/0012).
 */
function whyNotTheirs(held: RunRow, who: HeldUser): ReturnType<typeof refusal> | null {
  return held.driverId === who.id
    ? null
    : refusal('RUN_NOT_YOURS', 'That run is not yours to say anything about.');
}

/** A ticket row as a client reads it, with the band read off what it is made of. */
function asTicket(row: Row, prefix: string, context: Context) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: `${prefix}-${row.number}`,
    number: row.number,
    kind: row.kind,
    title: row.title,
    body: row.body,
    criteria: row.criteria,
    gate: row.gate,
    band: bandOf(row, context.children, context.claim, context.runs),
    rank: row.rank,
    branch: branchOf(row, prefix, context.runs),
    author: context.author,
    gates: context.gates,
    children: context.children,
    claim: context.claim === null ? null : asClaim(context.claim),
    runs: context.runs.map(asRun),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    closure: row.closure,
    sourceChatId: row.sourceChatId,
    outcome: context.outcome === null ? null : asOutcomeValue(context.outcome),
    decisionsSoFar: context.decisionsSoFar.map(asOutcomeValue),
  };
}

/**
 * The band a ticket is in, derived rather than stored.
 *
 * A claim comes first, so a ticket somebody is working is running whatever else is
 * true of it — including having been closed while a run went, which is a thing that
 * happens and not a thing to hide. Closure is next, so that closing an idea nobody ever
 * asked for still lands in Done, and a ticket closed while a proposal waited is done
 * rather than waiting on somebody to answer. Then a run that left a person's turn
 * unanswered: a proposal nobody has judged, or a run that stopped needing somebody.
 * A draft after that, so a ticket nobody has said anything about is never counted as
 * work; then an open child keeps the parent out of the frontier; otherwise it is ready.
 */
function bandOf(row: Row, children: Named[], held: Held | null, runs: RunRow[]) {
  if (held !== null) return 'running';
  if (row.closedAt !== null) return 'done';
  // A question has no agent claim or run: its linked chat is the person's claim.
  // Keeping the link on the ticket makes opening it again idempotent and keeps it
  // Needs you after a sent-back Outcome.
  if (row.kind === 'question' && row.sourceChatId !== null) return 'needs-you';
  if (waitingOnAPerson(runs)) return 'needs-you';
  if (row.gate === 'draft') return 'draft';
  // Maps are coordination records, not executable work. Their open question and
  // research children keep them Blocked; once those Outcomes are all approved,
  // Kira's destination-spec proposal is the person's next turn.
  if (row.kind === 'map') return children.some((each) => !each.closed) ? 'blocked' : 'needs-you';
  if (children.some((each) => !each.closed)) return 'blocked';
  if (row.kind === 'spec' && children.length === 0) return 'blocked';

  return 'ready';
}

/**
 * Whether a ticket is waiting on a person rather than on the queue.
 *
 * Its newest run ended with no verdict on it: either it made a proposal nobody has
 * answered yet, or it stopped saying it needed somebody. Both are a person's turn
 * rather than the queue's (docs/adr/0011).
 */
function waitingOnAPerson(runs: RunRow[]): boolean {
  const last = runs[0];
  if (last === undefined) return false;

  return last.endedAt !== null && last.verdict === null;
}

/**
 * The name a branch for this ticket would carry, derived from what it says.
 *
 * Derived rather than stored, so nothing can disagree with it — and the limit
 * that carries is accepted: a retitle changes the name, and a branch made before
 * a retitle keeps the name it was made with. Nothing here claims a branch
 * exists. When a run records the branch it made, the ticket shows that instead
 * (GH #64).
 */
function branchFor(prefix: string, number: number, title: string) {
  const slug = slugOf(title);
  const name = `${prefix.toLowerCase()}-${number}`;

  return slug === '' ? name : `${name}-${slug}`;
}

/**
 * A title reduced to the part of a branch name git will take.
 *
 * Everything that is not a letter or a digit separates words, and whole words are
 * dropped once the next would push the name past its limit — so the cut lands
 * between words rather than through one. A title with nothing usable in it comes to
 * nothing, and the branch is the ticket's own name.
 *
 * A slash is deliberately not allowed through: a branch is one name here, not a
 * little tree, and `..`, a leading dash and a trailing `.lock` are things git
 * refuses or misreads rather than names.
 */
function slugOf(title: string) {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((each) => each !== '');

  const kept: string[] = [];
  let length = 0;

  for (const word of words) {
    const grew = length + (kept.length === 0 ? 0 : 1) + word.length;
    if (grew > SLUG_LIMIT) break;

    kept.push(word);
    length = grew;
  }

  // A first word longer than the whole allowance is cut rather than dropped: a
  // branch named after the ticket alone says less than a truncated word does.
  if (kept.length === 0 && words[0] !== undefined) return words[0].slice(0, SLUG_LIMIT);

  return kept.join('-');
}

function asNamed(row: Row, prefix: string): Named {
  return {
    id: row.id,
    name: `${prefix}-${row.number}`,
    closed: row.closedAt !== null,
    closure: row.closure,
  };
}

function asProject(row: typeof project.$inferSelect) {
  return { id: row.id, name: row.name, prefix: row.prefix };
}

/** How many criteria are really there, since a blank one is not a criterion. */
function liveCriteria(criteria: string[]): number {
  return criteria.filter((each) => each.trim() !== '').length;
}

/** How many of these tickets are in a band. */
function bandCount(tickets: { band: string }[], band: string): number {
  return tickets.filter((each) => each.band === band).length;
}

/** The code Postgres refused with, however many wrappers it arrived in. */
function postgresCode(error: unknown): string | null {
  let at: unknown = error;

  for (let depth = 0; depth < 5 && at !== undefined && at !== null; depth += 1) {
    const code = (at as { code?: unknown }).code;
    if (typeof code === 'string') return code;

    at = (at as { cause?: unknown }).cause;
  }

  return null;
}

function isOneOf<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value);
}

function isText(value: string | null): value is string {
  return value !== null;
}

function isThere<T>(value: T | undefined): value is T {
  return value !== undefined;
}
