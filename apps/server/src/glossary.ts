/**
 * Project language, owned by the server rather than by a chat or a desktop.
 *
 * The current row is the quick read and the history rows are immutable snapshots.
 * A version is part of the write contract: an Undo names the version the person
 * saw, so a later edit cannot be silently overwritten by an old button.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Database } from './database';
import { keyHolder, type HeldUser } from './keys';
import { refusal, REFUSAL } from './refusals';
import { glossaryEntry, glossaryHistory, project, user } from './schema';

const AUTHOR = t.Union([t.Object({ id: t.String(), name: t.String() }), t.Null()]);
const HISTORY = t.Object({
  version: t.Integer(),
  term: t.String(),
  meaning: t.String(),
  wordsToAvoid: t.Array(t.String()),
  author: AUTHOR,
  chatId: t.String(),
  changedAt: t.String(),
});
const ENTRY = t.Object({
  id: t.String(),
  projectId: t.String(),
  term: t.String(),
  meaning: t.String(),
  wordsToAvoid: t.Array(t.String()),
  version: t.Integer(),
  author: AUTHOR,
  chatId: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
  history: t.Array(HISTORY),
});
const LIST = t.Object({ glossary: t.Array(ENTRY) });
const ONE = t.Object({ entry: ENTRY });

export function createGlossary({ auth, database }: { auth: Auth; database: Database }) {
  return new Elysia()
    .get(
      '/api/projects/:ref/glossary',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await projectFor(database, params.ref);
        if (found === null) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        return { glossary: await readEntries(database, found.id) };
      },
      {
        params: t.Object({ ref: t.String() }),
        response: { 200: LIST, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Read the current project glossary and its history' },
      },
    )
    .post(
      '/api/projects/:ref/glossary',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await projectFor(database, params.ref);
        if (found === null) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        const input = glossaryInput(body);
        if (input === null) {
          return status(
            400,
            refusal(
              'GLOSSARY_INVALID',
              'A glossary entry needs a term, meaning, words to avoid and chat.',
            ),
          );
        }

        const entry = await database.transaction(async (transaction) => {
          const [current] = await transaction
            .select()
            .from(glossaryEntry)
            .where(
              and(
                eq(glossaryEntry.projectId, found.id),
                sql`lower(${glossaryEntry.term}) = lower(${input.term})`,
              ),
            );
          const at = new Date();

          if (current === undefined) {
            const made = {
              id: randomUUID(),
              projectId: found.id,
              term: input.term,
              meaning: input.meaning,
              wordsToAvoid: input.wordsToAvoid,
              authorId: held.user.id,
              chatId: input.chatId,
              version: 1,
              createdAt: at,
              updatedAt: at,
            };
            await transaction.insert(glossaryEntry).values(made);
            await transaction.insert(glossaryHistory).values({
              id: randomUUID(),
              entryId: made.id,
              version: made.version,
              term: made.term,
              meaning: made.meaning,
              wordsToAvoid: made.wordsToAvoid,
              authorId: made.authorId,
              chatId: made.chatId,
              changedAt: at,
            });
            return made;
          }

          const next = {
            ...current,
            meaning: input.meaning,
            wordsToAvoid: input.wordsToAvoid,
            authorId: held.user.id,
            chatId: input.chatId,
            version: current.version + 1,
            updatedAt: at,
          };
          await transaction
            .update(glossaryEntry)
            .set({
              meaning: next.meaning,
              wordsToAvoid: next.wordsToAvoid,
              authorId: next.authorId,
              chatId: next.chatId,
              version: next.version,
              updatedAt: next.updatedAt,
            })
            .where(eq(glossaryEntry.id, current.id));
          await transaction.insert(glossaryHistory).values({
            id: randomUUID(),
            entryId: current.id,
            version: next.version,
            term: next.term,
            meaning: next.meaning,
            wordsToAvoid: next.wordsToAvoid,
            authorId: next.authorId,
            chatId: next.chatId,
            changedAt: at,
          });
          return next;
        });

        return { entry: await readOne(database, entry.id) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({
          term: t.String(),
          meaning: t.String(),
          wordsToAvoid: t.Array(t.String()),
          chatId: t.String(),
        }),
        response: { 200: ONE, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Add or sharpen a project glossary term' },
      },
    )
    .post(
      '/api/projects/:ref/glossary/:entryId/undo',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await projectFor(database, params.ref);
        if (found === null) return status(404, refusal('PROJECT_NOT_FOUND', 'No such project.'));

        const undone = await database.transaction(async (transaction) => {
          const [current] = await transaction
            .select()
            .from(glossaryEntry)
            .where(and(eq(glossaryEntry.id, params.entryId), eq(glossaryEntry.projectId, found.id)))
            .for('update');
          if (current === undefined) return { kind: 'missing' as const };
          if (!Number.isInteger(body.version) || body.version !== current.version) {
            return { kind: 'stale' as const };
          }
          if (current.version <= 1) return { kind: 'none' as const };

          const [previous] = await transaction
            .select()
            .from(glossaryHistory)
            .where(
              and(
                eq(glossaryHistory.entryId, current.id),
                eq(glossaryHistory.version, current.version - 1),
              ),
            );
          if (previous === undefined) return { kind: 'none' as const };

          const at = new Date();
          const nextVersion = current.version + 1;
          await transaction
            .update(glossaryEntry)
            .set({
              meaning: previous.meaning,
              wordsToAvoid: previous.wordsToAvoid,
              authorId: held.user.id,
              chatId: body.chatId,
              version: nextVersion,
              updatedAt: at,
            })
            .where(eq(glossaryEntry.id, current.id));
          await transaction.insert(glossaryHistory).values({
            id: randomUUID(),
            entryId: current.id,
            version: nextVersion,
            term: previous.term,
            meaning: previous.meaning,
            wordsToAvoid: previous.wordsToAvoid,
            authorId: held.user.id,
            chatId: body.chatId,
            changedAt: at,
          });
          return { kind: 'ok' as const, id: current.id };
        });

        if (undone.kind === 'missing') {
          return status(404, refusal('GLOSSARY_NOT_FOUND', 'No such glossary entry.'));
        }
        if (undone.kind === 'stale') {
          return status(
            409,
            refusal('GLOSSARY_STALE', 'That glossary change is no longer current.'),
          );
        }
        if (undone.kind === 'none') {
          return status(
            400,
            refusal('GLOSSARY_NO_PREVIOUS', 'That glossary entry has no previous version.'),
          );
        }

        return { entry: await readOne(database, undone.id) };
      },
      {
        params: t.Object({ ref: t.String(), entryId: t.String() }),
        body: t.Object({ version: t.Integer(), chatId: t.String() }),
        response: { 200: ONE, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL, 409: REFUSAL },
        detail: { summary: 'Undo a current glossary change without overwriting newer work' },
      },
    );
}

async function projectFor(database: Database, id: string) {
  const [found] = await database.select().from(project).where(eq(project.id, id));
  return found ?? null;
}

async function readEntries(database: Database, projectId: string) {
  const rows = await database
    .select()
    .from(glossaryEntry)
    .where(eq(glossaryEntry.projectId, projectId))
    .orderBy(asc(glossaryEntry.term));
  return await asEntries(database, rows);
}

async function readOne(database: Database, id: string) {
  const [row] = await database.select().from(glossaryEntry).where(eq(glossaryEntry.id, id));
  if (row === undefined) throw new Error('Glossary entry disappeared.');
  const [entry] = await asEntries(database, [row]);
  if (entry === undefined) throw new Error('Glossary entry disappeared.');
  return entry;
}

async function asEntries(database: Database, rows: (typeof glossaryEntry.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const histories = await database
    .select()
    .from(glossaryHistory)
    .where(
      inArray(
        glossaryHistory.entryId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(glossaryHistory.version));
  const authorIds = [
    ...new Set(
      [...rows.map((row) => row.authorId), ...histories.map((row) => row.authorId)].filter(isText),
    ),
  ];
  const people =
    authorIds.length === 0
      ? []
      : await database
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, authorIds));
  const authors = new Map(people.map((person) => [person.id, person]));
  const byEntry = new Map<string, typeof histories>();
  for (const row of histories) byEntry.set(row.entryId, [...(byEntry.get(row.entryId) ?? []), row]);

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    term: row.term,
    meaning: row.meaning,
    wordsToAvoid: row.wordsToAvoid,
    version: row.version,
    author: row.authorId === null ? null : (authors.get(row.authorId) ?? null),
    chatId: row.chatId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    history: (byEntry.get(row.id) ?? []).map((history) => ({
      version: history.version,
      term: history.term,
      meaning: history.meaning,
      wordsToAvoid: history.wordsToAvoid,
      author: history.authorId === null ? null : (authors.get(history.authorId) ?? null),
      chatId: history.chatId,
      changedAt: history.changedAt.toISOString(),
    })),
  }));
}

function glossaryInput(body: {
  term: string;
  meaning: string;
  wordsToAvoid: string[];
  chatId: string;
}) {
  const term = body.term.trim();
  const meaning = body.meaning.trim();
  const wordsToAvoid = body.wordsToAvoid.map((word) => word.trim()).filter((word) => word !== '');
  const chatId = body.chatId.trim();
  if (term === '' || meaning === '' || chatId === '') return null;

  return { term, meaning, wordsToAvoid, chatId };
}

type Asking = { readonly refused: ReturnType<typeof refusal> } | { readonly user: HeldUser };

async function asking(auth: Auth, request: Request): Promise<Asking> {
  const held = await keyHolder(auth, request);
  if ('refusal' in held) return { refused: refusal(held.refusal.code, held.refusal.message) };
  return { user: held.user };
}

function isText(value: string | null): value is string {
  return value !== null;
}
