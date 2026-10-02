/**
 * The tracker's own domain: projects, tickets, statuses and blockers.
 *
 * One relation, read from either end. A ticket names the tickets that gate it, so
 * its *children* are the tickets it names as gates — the parent names its slices,
 * which is what holds the parent out of the frontier until they land — and the
 * slices show the parent they hold up. There is no parent column and nothing stores
 * a tree (docs/adr/0017-a-ticket-is-one-object-with-children.md).
 *
 * A ticket's status is stored. An open blocker adds a Blocked marker without changing
 * that status.
 *
 * A project is shared work. It is readable and writable by anyone signed in, and it
 * outlives the person who wrote it — authorship is cleared rather than cascaded, the
 * one place these tables diverge from the shape `usage` uses.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import { type ActivityEntry, recordActivity } from './activity';
import type { Auth } from './auth';
import { postgresCode, type Database } from './database';
import { keyHolder, type HeldUser } from './keys';
import { refusal, REFUSAL } from './refusals';
import { messages } from './messages';
import {
  gate,
  outcome,
  project,
  ticket,
  ticketRelationship,
  user,
  type OutcomeDecisionProposal,
} from './schema';

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

/** Human-facing columns on the Project Work board. */
const STATUSES = ['draft', 'ready', 'running', 'needs-review', 'done', 'wont-do'] as const;

/** Person-owned urgency, from highest to lowest. */
const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;

/** Planning relationships are deliberately separate from execution gates. */
const RELATIONSHIPS = ['parent', 'blocks', 'related', 'duplicate'] as const;

/**
 * A prefix: two to six characters, starting with a letter.
 *
 * Held uppercase, always, which is what makes the unique constraint a rule about
 * case as well as about spelling — `FND` and `fnd` cannot both exist, because only
 * one of them can (GH #57).
 */
const PREFIX = /^[A-Z][A-Z0-9]{1,5}$/;

/** How much of a title a branch name carries, so the name stays readable. */

const PROJECT = t.Object({
  id: t.String(),
  name: t.String(),
  prefix: t.String(),
});

/** A ticket at the other end of a blocker or parent link. */
const NAMED = t.Object({
  id: t.String(),
  name: t.String(),
  status: t.String(),
});
const ASSIGNEE = t.Union([t.Object({ id: t.String(), name: t.String() }), t.Null()]);
const RELATIONSHIP = t.Object({
  type: t.String(),
  ticket: NAMED,
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
  blocked: t.Boolean(),
  rank: t.Integer(),
  status: t.String(),
  priority: t.String(),
  pullRequestUrl: t.Union([t.String(), t.Null()]),
  assignee: ASSIGNEE,
  tags: t.Array(t.String()),
  author: t.Union([t.Object({ id: t.String(), name: t.String() }), t.Null()]),
  gates: t.Array(NAMED),
  children: t.Array(NAMED),
  parent: t.Union([NAMED, t.Null()]),
  subIssues: t.Array(NAMED),
  relationships: t.Array(RELATIONSHIP),
  createdAt: t.String(),
  updatedAt: t.String(),
  sourceChatId: t.Union([t.String(), t.Null()]),
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
/** A row of the ticket table. */
type Row = typeof ticket.$inferSelect;

/** A linked ticket, as the read carries it. */
interface Named {
  id: string;
  name: string;
  status: string;
}

/** Everything the read of one ticket needs that is not on its own row. */
interface Context {
  author: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  gates: Named[];
  children: Named[];
  parent: Named | null;
  subIssues: Named[];
  relationships: { type: string; ticket: Named }[];
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
          return status(400, refusal('NAME_REQUIRED', messages.nameRequired));
        }

        // Uppercased before it is judged, so `fnd` is the prefix `FND` rather than a
        // refusal about case — and a prefix somebody else already holds is refused
        // however it was typed.
        const prefix = body.prefix.trim().toUpperCase();
        if (!PREFIX.test(prefix)) {
          return status(400, refusal('PREFIX_INVALID', messages.prefixInvalid));
        }

        const made = { id: randomUUID(), name, prefix, authorId: held.user.id };

        try {
          await database.insert(project).values(made);
        } catch (error) {
          if (postgresCode(error) === '23505') {
            return status(409, refusal('PREFIX_TAKEN', messages.prefixTaken(prefix)));
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
        if (!found) return status(404, refusal('PROJECT_NOT_FOUND', messages.projectNotFound));

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
              running: t.Integer(),
              'needs-review': t.Integer(),
              done: t.Integer(),
              'wont-do': t.Integer(),
            }),
          }),
          401: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'One project with its tickets and status counts' },
      },
    )
    .post(
      '/api/projects/:ref/tickets',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const [found] = await database.select().from(project).where(eq(project.id, params.ref));
        if (!found) return status(404, refusal('PROJECT_NOT_FOUND', messages.projectNotFound));

        if (!isOneOf(KINDS, body.kind ?? 'feature')) {
          return status(400, refusal('KIND_UNKNOWN', messages.kindUnknown(KINDS)));
        }
        if (!isOneOf(STATUSES, body.status ?? 'draft')) {
          return status(400, refusal('STATUS_UNKNOWN', messages.statusUnknown(STATUSES)));
        }
        if (!isOneOf(PRIORITIES, body.priority ?? 'none')) {
          return status(400, refusal('PRIORITY_UNKNOWN', messages.priorityUnknown(PRIORITIES)));
        }
        if (body.tags?.some((tag) => tag.trim() === '')) {
          return status(400, refusal('TAG_INVALID', messages.tagEmpty));
        }
        if (body.assigneeId !== undefined && body.assigneeId !== null) {
          const [assignee] = await database
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, body.assigneeId));
          if (!assignee)
            return status(400, refusal('ASSIGNEE_NOT_FOUND', messages.assigneeNotFound));
        }

        const written = await allocate(database, {
          projectId: found.id,
          kind: body.kind ?? 'feature',
          title: body.title.trim(),
          body: body.body ?? '',
          criteria: body.criteria ?? [],
          status: body.status ?? 'draft',
          priority: body.priority ?? 'none',
          assigneeId: body.assigneeId ?? null,
          tags: cleanTags(body.tags ?? []),
          authorId: held.user.id,
          sourceChatId: body.sourceChatId ?? null,
        });

        await recordActivity(database, [
          {
            ticketId: written.id,
            actorId: held.user.id,
            actorKind: 'member',
            action: 'created',
          },
        ]);

        return { ticket: await one(database, found, written) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({
          kind: t.Optional(t.String()),
          title: t.String(),
          body: t.Optional(t.String()),
          criteria: t.Optional(t.Array(t.String())),
          status: t.Optional(t.String()),
          priority: t.Optional(t.String()),
          assigneeId: t.Optional(t.Union([t.String(), t.Null()])),
          tags: t.Optional(t.Array(t.String())),
          sourceChatId: t.Optional(t.String()),
        }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Create a ticket in a project' },
      },
    )
    .post(
      '/api/projects/:ref/maps',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const [found] = await database.select().from(project).where(eq(project.id, params.ref));
        if (!found) return status(404, refusal('PROJECT_NOT_FOUND', messages.projectNotFound));

        const written = await database.transaction(async (transaction) => {
          const map = await allocate(transaction as unknown as Database, {
            projectId: found.id,
            kind: 'map',
            title: body.title.trim(),
            body: body.body,
            criteria: body.criteria,
            status: 'needs-review',
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
                status: kind === 'question' ? 'needs-review' : 'ready',
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
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));
        if (found.ticket.kind !== 'map') {
          return status(400, refusal('MAP_REQUIRED', messages.mapRequired));
        }
        if (isClosed(found.ticket.status)) {
          return status(400, refusal('TICKET_CLOSED', messages.mapClosed));
        }
        if (found.ticket.authorId !== held.user.id) {
          return status(403, refusal('MAP_NOT_YOURS', messages.mapNotYours));
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
          childRows.some((child) => !isClosed(child.status)) ||
          (
            await outcomesFor(
              database,
              childRows.map((child) => child.id),
            )
          ).size !== childRows.length
        ) {
          return status(400, refusal('MAP_CHILDREN_OPEN', messages.mapChildrenOpen));
        }

        const written = await database.transaction(async (transaction) => {
          const spec = await allocate(transaction as unknown as Database, {
            projectId: found.project.id,
            kind: 'spec',
            title: body.title.trim(),
            body: body.body,
            criteria: body.criteria,
            status: 'ready',
            authorId: held.user.id,
            sourceChatId: body.sourceChatId ?? null,
          });
          await transaction.insert(gate).values({
            ticketId: found.ticket.id,
            gatedById: spec.id,
          });
          await transaction
            .update(ticket)
            .set({ status: 'done', updatedAt: new Date() })
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
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));
        if (found.ticket.kind !== 'spec') {
          return status(400, refusal('BREAKDOWN_NOT_SPEC', messages.breakdownNotSpecToPublish));
        }
        if ((await childrenOf(database, found.ticket.id)).length > 0) {
          return status(
            400,
            refusal('BREAKDOWN_ALREADY_PUBLISHED', messages.breakdownAlreadyPublished),
          );
        }
        if (body.children.length === 0) {
          return status(400, refusal('BREAKDOWN_EMPTY', messages.breakdownEmpty));
        }

        const ids = new Set<string>();
        for (const child of body.children) {
          if (ids.has(child.id)) {
            return status(400, refusal('BREAKDOWN_DUPLICATE', messages.breakdownDuplicate));
          }
          ids.add(child.id);
          if (!isOneOf(KINDS, child.kind)) {
            return status(400, refusal('KIND_UNKNOWN', messages.kindUnknown(KINDS)));
          }
          if (child.dependsOn.includes(child.id)) {
            return status(400, refusal('GATE_SELF', messages.blockerSelf));
          }
          if (
            child.dependsOn.some(
              (dependency) =>
                !ids.has(dependency) && !body.children.some((each) => each.id === dependency),
            )
          ) {
            return status(
              400,
              refusal('BREAKDOWN_DEPENDENCY_UNKNOWN', messages.breakdownBlockerUnknown),
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
          return status(400, refusal('GATE_CIRCLE', messages.blockerCircle));
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
              status: 'draft',
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
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));
        if (found.ticket.kind !== 'spec') {
          return status(400, refusal('BREAKDOWN_NOT_SPEC', messages.breakdownNotSpecToReady));
        }

        const rows = await database
          .select({ child: ticket })
          .from(gate)
          .innerJoin(ticket, eq(ticket.id, gate.gatedById))
          .where(eq(gate.ticketId, found.ticket.id));
        if (rows.length === 0) {
          return status(400, refusal('BREAKDOWN_EMPTY', messages.breakdownEmpty));
        }
        if (
          rows.some(({ child }) => !child.criteria.some((criterion) => criterion.trim() !== ''))
        ) {
          return status(400, refusal('CRITERIA_REQUIRED', messages.criteriaRequired));
        }
        const drafts = rows
          .filter(({ child }) => child.status === 'draft')
          .map(({ child }) => child.id);
        if (drafts.length > 0) {
          await database.transaction(async (transaction) => {
            await transaction
              .update(ticket)
              .set({ status: 'ready', updatedAt: new Date() })
              .where(and(inArray(ticket.id, drafts), eq(ticket.status, 'draft')));
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
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));

        return { ticket: await one(database, found.project, found.ticket) };
      },
      {
        params: t.Object({ ref: t.String() }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'One ticket in full, by its id or by its name' },
      },
    )
    .post(
      '/api/tickets/:ref/question-chat',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));
        if (found.ticket.kind !== 'question') {
          return status(400, refusal('QUESTION_KIND_REQUIRED', messages.questionKindRequired));
        }
        if (found.ticket.authorId !== held.user.id) {
          return status(403, refusal('QUESTION_NOT_YOURS', messages.questionNotYours));
        }
        if (isClosed(found.ticket.status)) {
          return status(400, refusal('TICKET_CLOSED', messages.questionClosed));
        }
        if (found.ticket.status === 'draft') {
          return status(400, refusal('QUESTION_NOT_READY', messages.questionNotReady));
        }

        const chatId = found.ticket.sourceChatId ?? body.chatId?.trim() ?? randomUUID();
        if (chatId === '') {
          return status(400, refusal('CHAT_ID_REQUIRED', messages.chatIdRequired));
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
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));
        const heldOutcome = await outcomeOn(database, found.ticket.id);
        if (heldOutcome === null)
          return status(404, refusal('OUTCOME_NOT_FOUND', messages.outcomeNotFound));
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
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));
        if (found.ticket.kind !== 'research') {
          return status(400, refusal('OUTCOME_RESEARCH_ONLY', messages.outcomeResearchOnly));
        }
        const checked = outcomeInput(body);
        if ('refused' in checked) return status(400, checked.refused);
        if (found.ticket.authorId !== held.user.id) {
          return status(403, refusal('OUTCOME_NOT_YOURS', messages.outcomeNotYoursResearch));
        }
        if (
          isClosed(found.ticket.status) ||
          (await outcomeOn(database, found.ticket.id)) !== null
        ) {
          return status(400, refusal('OUTCOME_EXISTS', messages.outcomeExists));
        }

        const made = madeOutcome(found.ticket.id, held.user.id, checked.value);
        await database.transaction(async (transaction) => {
          await transaction.insert(outcome).values(made);
          await transaction
            .update(ticket)
            .set({ status: 'done', updatedAt: made.createdAt })
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
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));
        if (found.ticket.kind !== 'question') {
          return status(400, refusal('OUTCOME_QUESTION_ONLY', messages.outcomeQuestionOnly));
        }
        if (found.ticket.authorId !== held.user.id) {
          return status(403, refusal('OUTCOME_NOT_YOURS', messages.outcomeNotYoursQuestion));
        }
        if (found.ticket.sourceChatId === null || body.sourceChatId !== found.ticket.sourceChatId) {
          return status(400, refusal('QUESTION_CHAT_REQUIRED', messages.questionChatRequired));
        }
        const checked = outcomeInput(body);
        if ('refused' in checked) return status(400, checked.refused);
        if (
          isClosed(found.ticket.status) ||
          (await outcomeOn(database, found.ticket.id)) !== null
        ) {
          return status(400, refusal('OUTCOME_EXISTS', messages.outcomeExists));
        }

        const made = madeOutcome(found.ticket.id, held.user.id, checked.value);
        await database.transaction(async (transaction) => {
          await transaction.insert(outcome).values(made);
          await transaction
            .update(ticket)
            .set({ status: 'done', updatedAt: made.createdAt })
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
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));

        if (body.status !== undefined && !isOneOf(STATUSES, body.status)) {
          return status(400, refusal('STATUS_UNKNOWN', messages.statusUnknown(STATUSES)));
        }
        if (body.priority !== undefined && !isOneOf(PRIORITIES, body.priority)) {
          return status(400, refusal('PRIORITY_UNKNOWN', messages.priorityUnknown(PRIORITIES)));
        }
        if (
          body.pullRequestUrl !== undefined &&
          body.pullRequestUrl !== null &&
          !isHttpsUrl(body.pullRequestUrl)
        ) {
          return status(400, refusal('PULL_REQUEST_URL_INVALID', messages.pullRequestUrlInvalid));
        }
        if (body.tags?.some((tag) => tag.trim() === '')) {
          return status(400, refusal('TAG_INVALID', messages.tagEmpty));
        }
        if (body.assigneeId !== undefined && body.assigneeId !== null) {
          const [assignee] = await database
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, body.assigneeId));
          if (!assignee)
            return status(400, refusal('ASSIGNEE_NOT_FOUND', messages.assigneeNotFound));
        }
        const after: Row = {
          ...found.ticket,
          title: body.title?.trim() ?? found.ticket.title,
          body: body.body ?? found.ticket.body,
          criteria: body.criteria ?? found.ticket.criteria,
          rank: body.rank ?? found.ticket.rank,
          status: body.status ?? found.ticket.status,
          priority: body.priority ?? found.ticket.priority,
          pullRequestUrl:
            body.pullRequestUrl === undefined ? found.ticket.pullRequestUrl : body.pullRequestUrl,
          assigneeId: body.assigneeId === undefined ? found.ticket.assigneeId : body.assigneeId,
          tags: body.tags === undefined ? found.ticket.tags : cleanTags(body.tags),
        };

        const changed = {
          title: after.title,
          body: after.body,
          criteria: after.criteria,
          rank: after.rank,
          status: after.status,
          priority: after.priority,
          pullRequestUrl: after.pullRequestUrl,
          assigneeId: after.assigneeId,
          tags: after.tags,
          updatedAt: new Date(),
        };

        await database.update(ticket).set(changed).where(eq(ticket.id, found.ticket.id));

        await recordActivity(
          database,
          await changesTo(database, found.ticket, after, held.user.id),
        );

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
          rank: t.Optional(t.Integer()),
          status: t.Optional(t.String()),
          priority: t.Optional(t.String()),
          pullRequestUrl: t.Optional(t.Union([t.String(), t.Null()])),
          assigneeId: t.Optional(t.Union([t.String(), t.Null()])),
          tags: t.Optional(t.Array(t.String())),
        }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: {
          summary: 'Update a ticket’s fields and status',
        },
      },
    )
    .post(
      '/api/tickets/:ref/gates',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));

        const names = await resolve(database, body.gatedBy);
        if (!names) return status(404, refusal('TICKET_NOT_FOUND', messages.blockerTicketNotFound));

        const refused = await whyNot(database, found, names);
        if (refused) return status(400, refused);

        // Adding the same gate twice is the same gate: the table's primary key is the
        // pair, so this is the constraint doing the work rather than a read first.
        const [added] = await database
          .insert(gate)
          .values({ ticketId: found.ticket.id, gatedById: names.ticket.id })
          .onConflictDoNothing()
          .returning({ ticketId: gate.ticketId });

        if (added) {
          await recordActivity(database, [
            {
              ticketId: found.ticket.id,
              actorId: held.user.id,
              actorKind: 'member',
              action: 'blocker_added',
              details: { blocker: asNamed(names.ticket, names.project.prefix) },
            },
          ]);
        }

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
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));

        const names = await resolve(database, params.gatedBy);

        if (names) {
          const [removed] = await database
            .delete(gate)
            .where(and(eq(gate.ticketId, found.ticket.id), eq(gate.gatedById, names.ticket.id)))
            .returning({ ticketId: gate.ticketId });

          if (removed) {
            await recordActivity(database, [
              {
                ticketId: found.ticket.id,
                actorId: held.user.id,
                actorKind: 'member',
                action: 'blocker_removed',
                details: { blocker: asNamed(names.ticket, names.project.prefix) },
              },
            ]);
          }
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
      '/api/tickets/:ref/relationships',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));
        if (!isOneOf(RELATIONSHIPS, body.type)) {
          return status(
            400,
            refusal('RELATIONSHIP_UNKNOWN', messages.relationshipUnknown(RELATIONSHIPS)),
          );
        }

        const names = await resolve(database, body.ticket);
        if (!names) return status(404, refusal('TICKET_NOT_FOUND', messages.relatedTicketNotFound));
        if (names.project.id !== found.project.id) {
          return status(
            400,
            refusal('RELATIONSHIP_OTHER_PROJECT', messages.relationshipOtherProject),
          );
        }
        if (names.ticket.id === found.ticket.id) {
          return status(400, refusal('RELATIONSHIP_SELF', messages.relationshipSelf));
        }
        if (body.type === 'parent') {
          const [existing] = await database
            .select()
            .from(ticketRelationship)
            .where(
              and(
                eq(ticketRelationship.issueId, found.ticket.id),
                eq(ticketRelationship.type, 'parent'),
              ),
            );
          if (existing && existing.relatedIssueId !== names.ticket.id) {
            return status(400, refusal('PARENT_EXISTS', messages.parentExists));
          }
        }

        await database
          .insert(ticketRelationship)
          .values({ issueId: found.ticket.id, relatedIssueId: names.ticket.id, type: body.type })
          .onConflictDoNothing();
        await database
          .update(ticket)
          .set({ updatedAt: new Date() })
          .where(eq(ticket.id, found.ticket.id));

        return { ticket: await one(database, found.project, found.ticket) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({ type: t.String(), ticket: t.String() }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Add parent, blocking, related or duplicate context to an issue' },
      },
    )
    .delete(
      '/api/tickets/:ref/relationships/:type/:ticket',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);
        const found = await resolve(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));
        if (!isOneOf(RELATIONSHIPS, params.type)) {
          return status(400, refusal('RELATIONSHIP_UNKNOWN', messages.relationshipNotSupported));
        }
        const names = await resolve(database, params.ticket);
        if (names) {
          await database
            .delete(ticketRelationship)
            .where(
              and(
                eq(ticketRelationship.issueId, found.ticket.id),
                eq(ticketRelationship.relatedIssueId, names.ticket.id),
                eq(ticketRelationship.type, params.type),
              ),
            );
        }
        return { ticket: await one(database, found.project, found.ticket) };
      },
      {
        params: t.Object({ ref: t.String(), type: t.String(), ticket: t.String() }),
        response: { 200: ONE_TICKET, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Remove planning relationship context from an issue' },
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

/** Read a project's tickets, with blockers and assignees. */
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
  const assignees = await assigneesOf(database, rows);
  const planning = await planningFor(database, rows, held.prefix);
  const outcomes = await outcomesFor(
    database,
    rows.map((each) => each.id),
  );
  const named = new Map<string, Named>(rows.map((row) => [row.id, asNamed(row, held.prefix)]));

  const tickets = rows.map((row) =>
    asTicket(row, held.prefix, {
      author: row.authorId === null ? null : (authors.get(row.authorId) ?? null),
      assignee: row.assigneeId === null ? null : (assignees.get(row.assigneeId) ?? null),
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
      ...(planning.get(row.id) ?? emptyPlanning()),
    }),
  );

  return {
    project: asProject(held),
    tickets,
    counts: {
      draft: tickets.filter((each) => each.status === 'draft').length,
      ready: tickets.filter((each) => each.status === 'ready').length,
      running: tickets.filter((each) => each.status === 'running').length,
      'needs-review': tickets.filter((each) => each.status === 'needs-review').length,
      done: tickets.filter((each) => each.status === 'done').length,
      'wont-do': tickets.filter((each) => each.status === 'wont-do').length,
    },
  };
}

/** One ticket in full. */
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
  const assignees = await assigneesOf(database, [row]);
  const planning = await planningFor(database, [row], held.prefix);
  const childOutcomes =
    row.kind === 'map'
      ? await outcomesFor(
          database,
          edges.filter((each) => each.ticketId === row.id).map((each) => each.gatedById),
        )
      : new Map<string, OutcomeView>();
  return asTicket(row, held.prefix, {
    author: row.authorId === null ? null : (authors.get(row.authorId) ?? null),
    assignee: row.assigneeId === null ? null : (assignees.get(row.assigneeId) ?? null),
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
    ...(planning.get(row.id) ?? emptyPlanning()),
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
    return refusal('GATE_SELF', messages.blockerSelf);
  }
  if (names.project.id !== held.project.id) {
    return refusal('GATE_OTHER_PROJECT', messages.blockerOtherProject);
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
      return refusal('GATE_CIRCLE', messages.blockerCircle);
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

async function assigneesOf(database: Database, rows: Row[]) {
  const ids = [...new Set(rows.map((each) => each.assigneeId).filter(isText))];
  if (ids.length === 0) return new Map<string, { id: string; name: string }>();

  const people = await database
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, ids));

  return new Map(people.map((each) => [each.id, each]));
}

/** One person by id, or null when nobody holds it. */
async function personOf(
  database: Database,
  id: string | null,
): Promise<{ id: string; name: string } | null> {
  if (id === null) return null;

  const [found] = await database
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.id, id));

  return found ?? null;
}

/**
 * What an edit changed, one entry per field, for the ticket's history.
 *
 * An assignee change carries the person's name as well as their id, so a
 * timeline entry can be drawn without resolving anyone: a reader of old history
 * should not need the person to still be here (docs/adr/0026).
 */
async function changesTo(
  database: Database,
  before: Row,
  after: Row,
  actorId: string,
): Promise<ActivityEntry[]> {
  const entry = (
    action: ActivityEntry['action'],
    details: Record<string, unknown>,
  ): ActivityEntry => ({
    ticketId: after.id,
    actorId,
    actorKind: 'member',
    action,
    details,
  });
  const changes: ActivityEntry[] = [];

  if (after.status !== before.status) {
    changes.push(entry('status_changed', { from: before.status, to: after.status }));
  }
  if (after.priority !== before.priority) {
    changes.push(entry('priority_changed', { from: before.priority, to: after.priority }));
  }
  if (after.title !== before.title) {
    changes.push(entry('title_changed', { from: before.title, to: after.title }));
  }
  if (after.body !== before.body) {
    changes.push(entry('body_updated', {}));
  }
  if (!sameChecks(after.criteria, before.criteria)) {
    changes.push(entry('checks_changed', { from: before.criteria, to: after.criteria }));
  }
  if (after.assigneeId !== before.assigneeId) {
    const [was, now] = await Promise.all([
      personOf(database, before.assigneeId),
      personOf(database, after.assigneeId),
    ]);
    changes.push(entry('assignee_changed', { from: was, to: now }));
  }

  return changes;
}

/** Whether two check lists say the same thing, order included. */
function sameChecks(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, at) => line === right[at]);
}

interface Planning {
  parent: Named | null;
  subIssues: Named[];
  relationships: { type: string; ticket: Named }[];
}

function emptyPlanning(): Planning {
  return { parent: null, subIssues: [], relationships: [] };
}

async function planningFor(database: Database, rows: Row[], prefix: string) {
  const ids = rows.map((each) => each.id);
  const answer = new Map<string, ReturnType<typeof emptyPlanning>>(
    ids.map((id) => [id, emptyPlanning()]),
  );
  if (ids.length === 0) return answer;

  const edges = await database
    .select()
    .from(ticketRelationship)
    .where(
      or(inArray(ticketRelationship.issueId, ids), inArray(ticketRelationship.relatedIssueId, ids)),
    );
  const touched = [...new Set(edges.flatMap((edge) => [edge.issueId, edge.relatedIssueId]))];
  const related = await database.select().from(ticket).where(inArray(ticket.id, touched));
  const named = new Map(related.map((each) => [each.id, asNamed(each, prefix)]));

  for (const edge of edges) {
    const issue = answer.get(edge.issueId);
    const relatedIssue = named.get(edge.relatedIssueId);
    if (issue !== undefined && relatedIssue !== undefined) {
      if (edge.type === 'parent') issue.parent = relatedIssue;
      else issue.relationships.push({ type: edge.type, ticket: relatedIssue });
    }

    const child = answer.get(edge.relatedIssueId);
    const parent = named.get(edge.issueId);
    if (edge.type === 'parent' && child !== undefined && parent !== undefined) {
      child.subIssues.push(parent);
    }
  }

  return answer;
}

type OutcomeRow = typeof outcome.$inferSelect;

type OutcomeInput = {
  answer: string;
  sources: string[];
  sourceChatId: string | null;
  decisionProposal: OutcomeDecisionProposal | null;
};

function outcomeInput(
  value: unknown,
): { value: OutcomeInput } | { refused: ReturnType<typeof refusal> } {
  if (typeof value !== 'object' || value === null) {
    return { refused: refusal('OUTCOME_INVALID', messages.outcomeIncomplete) };
  }
  const held = value as Record<string, unknown>;
  const answer = typeof held.answer === 'string' ? held.answer.trim() : '';
  const sources = Array.isArray(held.sources)
    ? held.sources
        .filter((source): source is string => typeof source === 'string')
        .map((source) => source.trim())
    : [];
  if (answer === '' || sources.length === 0 || sources.some((source) => source === '')) {
    return { refused: refusal('OUTCOME_REQUIRED', messages.outcomeIncomplete) };
  }

  const raw = held.decisionProposal;
  let decisionProposal: OutcomeDecisionProposal | null = null;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'object') {
      return {
        refused: refusal('DECISION_PROPOSAL_INVALID', messages.decisionProposalInvalid),
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
        refused: refusal('DECISION_PROPOSAL_INVALID', messages.decisionProposalInvalid),
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
    status?: string;
    priority?: string;
    assigneeId?: string | null;
    tags?: string[];
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
      status: written.status ?? 'draft',
      priority: written.priority ?? 'none',
      pullRequestUrl: null,
      assigneeId: written.assigneeId ?? null,
      tags: written.tags ?? [],
      number: Number(highest?.number ?? 0) + 1,
      rank: Number(highest?.rank ?? 0) + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
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
 * The tickets this one names as blockers.
 *
 * This is the one read that asks for a single ticket's blockers rather than a queue's edges.
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

/** A ticket row as a client reads it. */
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
    status: row.status,
    blocked: context.children.some((each) => !isClosed(each.status)),
    priority: row.priority,
    pullRequestUrl: row.pullRequestUrl,
    assignee: context.assignee,
    tags: row.tags,
    rank: row.rank,
    author: context.author,
    gates: context.gates,
    children: context.children,
    parent: context.parent,
    subIssues: context.subIssues,
    relationships: context.relationships,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sourceChatId: row.sourceChatId,
    outcome: context.outcome === null ? null : asOutcomeValue(context.outcome),
    decisionsSoFar: context.decisionsSoFar.map(asOutcomeValue),
  };
}

function asNamed(row: Row, prefix: string): Named {
  return {
    id: row.id,
    name: `${prefix}-${row.number}`,
    status: row.status,
  };
}

function asProject(row: typeof project.$inferSelect) {
  return { id: row.id, name: row.name, prefix: row.prefix };
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag !== ''))];
}

function isClosed(status: string): boolean {
  return status === 'done' || status === 'wont-do';
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
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
