/**
 * Approved project Decisions.
 *
 * A proposal is only words in a chat. This route is the durable, person-approved
 * boundary: it writes one immutable record, and a later approval can point at the
 * record it supersedes without deleting or rewriting its content.
 */
import { randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Database } from './database';
import { keyHolder, type HeldUser } from './keys';
import { refusal, REFUSAL } from './refusals';
import { decision, project, user } from './schema';

const AUTHOR = t.Union([t.Object({ id: t.String(), name: t.String() }), t.Null()]);
const DECISION = t.Object({
  id: t.String(),
  projectId: t.String(),
  context: t.String(),
  choice: t.String(),
  rejectedOptions: t.Array(t.String()),
  consequences: t.String(),
  author: AUTHOR,
  sourceChatId: t.Union([t.String(), t.Null()]),
  supersededById: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
});
const ONE_DECISION = t.Object({ decision: DECISION });
const DECISIONS = t.Object({ decisions: t.Array(DECISION) });

type DecisionRow = typeof decision.$inferSelect;

type Asking = { readonly refused: ReturnType<typeof refusal> } | { readonly user: HeldUser };

export function createDecisions({ auth, database }: { auth: Auth; database: Database }) {
  return new Elysia()
    .get(
      '/api/projects/:ref/decisions',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const [found] = await database.select().from(project).where(eq(project.id, params.ref));
        if (!found) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        const rows = await database
          .select()
          .from(decision)
          .where(eq(decision.projectId, found.id))
          .orderBy(asc(decision.createdAt), asc(decision.id));

        return { decisions: await withAuthors(database, rows) };
      },
      {
        params: t.Object({ ref: t.String() }),
        response: { 200: DECISIONS, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Read approved project Decisions' },
      },
    )
    .post(
      '/api/projects/:ref/decisions',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const [found] = await database.select().from(project).where(eq(project.id, params.ref));
        if (!found) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        if (body.context.trim() === '') {
          return status(400, refusal('CONTEXT_REQUIRED', 'A Decision needs its context.'));
        }
        if (body.choice.trim() === '') {
          return status(400, refusal('CHOICE_REQUIRED', 'A Decision needs a choice.'));
        }
        if (body.consequences.trim() === '') {
          return status(
            400,
            refusal('CONSEQUENCES_REQUIRED', 'A Decision needs its consequences.'),
          );
        }
        if (body.rejectedOptions.some((option) => option.trim() === '')) {
          return status(400, refusal('OPTION_EMPTY', 'A rejected option needs words.'));
        }

        const superseded = body.supersedes
          ? await database
              .select()
              .from(decision)
              .where(eq(decision.id, body.supersedes))
              .then((rows) => rows[0])
          : undefined;
        if (body.supersedes !== undefined && superseded === undefined) {
          return status(404, refusal('DECISION_NOT_FOUND', 'No such Decision to supersede.'));
        }
        if (superseded !== undefined && superseded.projectId !== found.id) {
          return status(
            400,
            refusal('DECISION_OTHER_PROJECT', 'A Decision belongs to another project.'),
          );
        }
        if (superseded !== undefined && superseded.supersededById !== null) {
          return status(
            400,
            refusal('DECISION_SUPERSEDED', 'That Decision has already been superseded.'),
          );
        }

        const made: DecisionRow = {
          id: randomUUID(),
          projectId: found.id,
          context: body.context.trim(),
          choice: body.choice.trim(),
          rejectedOptions: body.rejectedOptions.map((option) => option.trim()),
          consequences: body.consequences.trim(),
          authorId: held.user.id,
          sourceChatId: body.sourceChatId ?? null,
          supersededById: null,
          createdAt: new Date(),
        };

        await database.transaction(async (transaction) => {
          await transaction.insert(decision).values(made);
          if (superseded !== undefined) {
            await transaction
              .update(decision)
              .set({ supersededById: made.id })
              .where(eq(decision.id, superseded.id));
          }
        });

        return { decision: (await withAuthors(database, [made]))[0]! };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({
          context: t.String(),
          choice: t.String(),
          rejectedOptions: t.Array(t.String()),
          consequences: t.String(),
          sourceChatId: t.Optional(t.String()),
          supersedes: t.Optional(t.String()),
        }),
        response: {
          200: ONE_DECISION,
          400: REFUSAL,
          401: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'Record a Decision after a person approves it' },
      },
    );
}

async function asking(auth: Auth, request: Request): Promise<Asking> {
  const held = await keyHolder(auth, request);
  if ('refusal' in held) return { refused: refusal(held.refusal.code, held.refusal.message) };
  return { user: held.user };
}

async function withAuthors(database: Database, rows: DecisionRow[]) {
  const ids = [
    ...new Set(rows.map((row) => row.authorId).filter((id): id is string => id !== null)),
  ];
  const people =
    ids.length === 0
      ? []
      : await database
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, ids));
  const authors = new Map(people.map((person) => [person.id, person]));

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    context: row.context,
    choice: row.choice,
    rejectedOptions: row.rejectedOptions,
    consequences: row.consequences,
    author: row.authorId === null ? null : (authors.get(row.authorId) ?? null),
    sourceChatId: row.sourceChatId,
    supersededById: row.supersededById,
    createdAt: row.createdAt.toISOString(),
  }));
}
