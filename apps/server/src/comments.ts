/**
 * A ticket's conversation and its history.
 *
 * Two things live on a ticket beside its fields: what people and Kira said about
 * it, and what the server recorded happening to it. They are written by different
 * hands and read as one timeline, because a reader asking "what happened here"
 * does not care which table answers (docs/adr/0026).
 *
 * A comment is written by a person or by Kira. `authorKind` is the client's word
 * that a write was Kira's: the desktop holds the person's key, so the server
 * cannot tell them apart on its own, and a forged `kira` is only a forged label
 * on something that person could write anyway.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Database } from './database';
import { keyHolder, type HeldUser } from './keys';
import { refusal, REFUSAL } from './refusals';
import { messages } from './messages';
import { project, ticket, ticketActivity, ticketComment, user } from './schema';

const AUTHOR = t.Union([t.Object({ id: t.String(), name: t.String() }), t.Null()]);

const COMMENT = t.Object({
  id: t.String(),
  ticketId: t.String(),
  parentId: t.Union([t.String(), t.Null()]),
  author: AUTHOR,
  authorKind: t.String(),
  body: t.String(),
  deleted: t.Boolean(),
  /** Whether the person asking wrote it, so the window can offer to change it. */
  mine: t.Boolean(),
  createdAt: t.String(),
  updatedAt: t.String(),
});
const ONE_COMMENT = t.Object({ comment: COMMENT });
const COMMENTS = t.Object({ comments: t.Array(COMMENT) });

const TIMELINE_COMMENT = t.Object({
  type: t.Literal('comment'),
  id: t.String(),
  author: AUTHOR,
  authorKind: t.String(),
  body: t.String(),
  parentId: t.Union([t.String(), t.Null()]),
  deleted: t.Boolean(),
  mine: t.Boolean(),
  createdAt: t.String(),
  updatedAt: t.String(),
});
const TIMELINE_ACTIVITY = t.Object({
  type: t.Literal('activity'),
  id: t.String(),
  actor: AUTHOR,
  actorKind: t.String(),
  action: t.String(),
  details: t.Any(),
  createdAt: t.String(),
});
const TIMELINE = t.Object({ entries: t.Array(t.Union([TIMELINE_COMMENT, TIMELINE_ACTIVITY])) });

/** How many entries one ticket's timeline will answer with when a limit is asked for. */
const TIMELINE_MAX = 500;

type CommentRow = typeof ticketComment.$inferSelect;
type ActivityRow = typeof ticketActivity.$inferSelect;

type Asking = { readonly refused: ReturnType<typeof refusal> } | { readonly user: HeldUser };

export function createComments({ auth, database }: { auth: Auth; database: Database }) {
  return new Elysia()
    .get(
      '/api/tickets/:ref/comments',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolveTicket(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));

        return { comments: await commentsOn(database, found.ticket.id, held.user.id) };
      },
      {
        params: t.Object({ ref: t.String() }),
        response: { 200: COMMENTS, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Every comment on a ticket, oldest first' },
      },
    )
    .post(
      '/api/tickets/:ref/comments',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolveTicket(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));

        const text = body.body.trim();
        if (text === '')
          return status(400, refusal('COMMENT_BODY_REQUIRED', messages.commentBodyRequired));

        if (body.parentId !== undefined) {
          const [parent] = await database
            .select()
            .from(ticketComment)
            .where(eq(ticketComment.id, body.parentId));
          if (!parent) return status(404, refusal('COMMENT_NOT_FOUND', messages.commentNotFound));
          if (parent.ticketId !== found.ticket.id) {
            return status(
              400,
              refusal('COMMENT_PARENT_OTHER_TICKET', messages.commentParentOtherTicket),
            );
          }
        }

        const made = {
          id: randomUUID(),
          ticketId: found.ticket.id,
          parentId: body.parentId ?? null,
          authorId: held.user.id,
          authorKind: body.authorKind === 'kira' ? 'kira' : 'member',
          body: text,
        };

        await database.insert(ticketComment).values(made);
        await database
          .update(ticket)
          .set({ updatedAt: new Date() })
          .where(eq(ticket.id, found.ticket.id));

        return {
          comment: asComment(
            { ...made, createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
            { id: held.user.id, name: held.user.name },
            held.user.id,
          ),
        };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({
          body: t.String(),
          parentId: t.Optional(t.String()),
          authorKind: t.Optional(t.Union([t.Literal('member'), t.Literal('kira')])),
        }),
        response: { 200: ONE_COMMENT, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Say something on a ticket, or reply to a comment on it' },
      },
    )
    .patch(
      '/api/comments/:id',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const [comment] = await database
          .select()
          .from(ticketComment)
          .where(eq(ticketComment.id, params.id));
        if (!comment) return status(404, refusal('COMMENT_NOT_FOUND', messages.commentNotFound));
        if (comment.deletedAt !== null) {
          return status(400, refusal('COMMENT_DELETED', messages.commentDeleted));
        }
        if (comment.authorId !== held.user.id) {
          return status(403, refusal('COMMENT_NOT_YOURS', messages.commentNotYours));
        }

        const text = body.body.trim();
        if (text === '')
          return status(400, refusal('COMMENT_BODY_REQUIRED', messages.commentBodyRequired));

        const updatedAt = new Date();
        await database
          .update(ticketComment)
          .set({ body: text, updatedAt })
          .where(eq(ticketComment.id, comment.id));

        return {
          comment: asComment(
            { ...comment, body: text, updatedAt },
            await authorOf(database, comment.authorId),
            held.user.id,
          ),
        };
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({ body: t.String() }),
        response: { 200: ONE_COMMENT, 400: REFUSAL, 401: REFUSAL, 403: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Change the words of a comment you wrote' },
      },
    )
    .delete(
      '/api/comments/:id',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const [comment] = await database
          .select()
          .from(ticketComment)
          .where(eq(ticketComment.id, params.id));
        if (!comment) return status(404, refusal('COMMENT_NOT_FOUND', messages.commentNotFound));
        if (comment.deletedAt !== null) {
          return status(400, refusal('COMMENT_DELETED', messages.commentDeleted));
        }
        if (comment.authorId !== held.user.id) {
          return status(403, refusal('COMMENT_NOT_YOURS', messages.commentNotYours));
        }

        const [reply] = await database
          .select({ id: ticketComment.id })
          .from(ticketComment)
          .where(eq(ticketComment.parentId, comment.id));

        if (reply) {
          // A thread with replies keeps its root as a tombstone, so the replies
          // below it do not lose the thing they answer.
          await database
            .update(ticketComment)
            .set({ body: '', deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(ticketComment.id, comment.id));
        } else {
          await database.delete(ticketComment).where(eq(ticketComment.id, comment.id));
        }

        await database
          .update(ticket)
          .set({ updatedAt: new Date() })
          .where(eq(ticket.id, comment.ticketId));

        return { comment: null };
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: t.Object({ comment: t.Null() }),
          400: REFUSAL,
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'Remove a comment you wrote, keeping any replies it has' },
      },
    )
    .get(
      '/api/tickets/:ref/timeline',
      async ({ request, params, query, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolveTicket(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));

        const limit = readLimit(query?.limit);
        if (limit === null)
          return status(400, refusal('LIMIT_INVALID', messages.timelineLimitInvalid));

        const entries: TimelineEntry[] = [
          ...(await commentsOn(database, found.ticket.id, held.user.id)).map(asTimelineComment),
          ...(await activityOn(database, found.ticket.id)),
        ];

        entries.sort(byMoment);

        return { entries: limit === undefined ? entries : entries.slice(-limit) };
      },
      {
        params: t.Object({ ref: t.String() }),
        query: t.Optional(t.Object({ limit: t.Optional(t.String()) })),
        response: { 200: TIMELINE, 400: REFUSAL, 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'A ticket’s comments and history as one timeline, oldest first' },
      },
    );
}

type TimelineEntry = ReturnType<typeof asTimelineComment> | ReturnType<typeof asTimelineActivity>;

/** The limit asked for, null when it cannot be read, undefined when none was asked. */
function readLimit(raw: string | undefined): number | null | undefined {
  if (raw === undefined || raw === '') return undefined;

  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > TIMELINE_MAX) return null;

  return limit;
}

/** Comments on one ticket, oldest first, each saying whether the asker wrote it. */
async function commentsOn(database: Database, ticketId: string, viewerId: string): Promise<View[]> {
  const rows = await database
    .select()
    .from(ticketComment)
    .where(eq(ticketComment.ticketId, ticketId))
    .orderBy(asc(ticketComment.createdAt), asc(ticketComment.id));

  const authors = await authorsOf(
    database,
    rows.map((each) => each.authorId),
  );

  return rows.map((row) => asComment(row, authors.get(row.authorId ?? '') ?? null, viewerId));
}

/** The history of one ticket, oldest first, each entry naming the person behind it. */
async function activityOn(database: Database, ticketId: string): Promise<ActivityView[]> {
  const rows = await database
    .select()
    .from(ticketActivity)
    .where(eq(ticketActivity.ticketId, ticketId))
    .orderBy(asc(ticketActivity.createdAt), asc(ticketActivity.id));

  const actors = await authorsOf(
    database,
    rows.map((each) => each.actorId),
  );

  return rows.map((row) => asTimelineActivity(row, actors.get(row.actorId ?? '') ?? null));
}

type View = ReturnType<typeof asComment>;
type ActivityView = ReturnType<typeof asTimelineActivity>;

function asComment(row: CommentRow, author: Member | null, viewerId: string) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    parentId: row.parentId,
    author,
    authorKind: row.authorKind,
    body: row.body,
    deleted: row.deletedAt !== null,
    mine: row.authorId !== null && row.authorId === viewerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function asTimelineComment(comment: View) {
  return {
    type: 'comment' as const,
    id: comment.id,
    author: comment.author,
    authorKind: comment.authorKind,
    body: comment.body,
    parentId: comment.parentId,
    deleted: comment.deleted,
    mine: comment.mine,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

function asTimelineActivity(row: ActivityRow, actor: Member | null) {
  return {
    type: 'activity' as const,
    id: row.id,
    actor,
    actorKind: row.actorKind,
    action: row.action,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Oldest first, ties broken by id so the order is total. */
function byMoment(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string },
) {
  return left.createdAt === right.createdAt
    ? left.id.localeCompare(right.id)
    : left.createdAt.localeCompare(right.createdAt);
}

type Member = { id: string; name: string };

/** The people behind a set of ids, by id. An id nobody holds is simply absent. */
async function authorsOf(
  database: Database,
  ids: readonly (string | null)[],
): Promise<Map<string, Member>> {
  const wanted = [...new Set(ids.filter((each): each is string => each !== null))];
  if (wanted.length === 0) return new Map();

  const rows = await database
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, wanted));

  return new Map(rows.map((each) => [each.id, each]));
}

async function authorOf(database: Database, id: string | null): Promise<Member | null> {
  if (id === null) return null;

  return (await authorsOf(database, [id])).get(id) ?? null;
}

/**
 * Which project and ticket a reference names: an id, or the name people say.
 *
 * Kept beside the tracker's own resolver rather than shared with it, the way
 * `asking` is repeated in each module: the two are small and a reader of this
 * file should not have to leave it to know how `:ref` resolves.
 */
async function resolveTicket(database: Database, ref: string) {
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

/** The person a request is from, or the refusal to answer it with. */
async function asking(auth: Auth, request: Request): Promise<Asking> {
  const held = await keyHolder(auth, request);
  if ('refusal' in held) return { refused: refusal(held.refusal.code, held.refusal.message) };

  return { user: held.user };
}
