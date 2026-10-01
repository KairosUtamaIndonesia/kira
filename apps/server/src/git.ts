/**
 * Git hosts Kira watches, and the pull requests that review its tickets.
 *
 * A project lists the repositories its work happens in. A pull request in one of
 * them is read from the host's webhook, recorded against the ticket it names, and
 * watched: a merge moves a ticket in Needs review to Done, which is the step ADR
 * 0024 left to a person. Nothing here clones or pushes — that is a run's business
 * — so this module is only the connection, the recognition and the state
 * (docs/adr/0026).
 *
 * The host is behind an adapter so the tables and the webhook route do not
 * assume GitHub. GitHub is the first adapter; Forgejo, Gitea and GitLab record
 * themselves in `git_connection` as their adapters land.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Config } from './config';
import type { Database } from './database';
import { recordActivity } from './activity';
import { keyHolder, type HeldUser } from './keys';
import { refusal, REFUSAL } from './refusals';
import { messages } from './messages';
import { project, repository, ticket, ticketPullRequest } from './schema';

/* ── The provider adapter ─────────────────────────────────────────────────── */

/** A pull request, as every adapter normalises it. State is already one word. */
interface PullRequestEvent {
  owner: string;
  name: string;
  number: number;
  title: string;
  /** open, draft, merged or closed. */
  state: 'open' | 'draft' | 'merged' | 'closed';
  url: string;
  branch: string | null;
  headSha: string;
  authorLogin: string | null;
  mergedAt: string | null;
}

interface GitProvider {
  kind: string;
  /** What the host says the delivery is, from its own headers. */
  eventKind(headers: Headers): 'pull_request' | 'other';
  /** Whether the delivery is signed with `secret` over the raw body. */
  verifySignature(secret: string, headers: Headers, body: Uint8Array): boolean;
  /** The pull request a delivery carries, or null when it is not one. */
  parsePullRequest(body: unknown): PullRequestEvent | null;
}

/** GitHub: HMAC-SHA256 over the raw body, `X-Hub-Signature-256`, `X-GitHub-Event`. */
const github: GitProvider = {
  kind: 'github',
  eventKind: (headers) =>
    headers.get('x-github-event') === 'pull_request' ? 'pull_request' : 'other',
  verifySignature(secret, headers, body) {
    const header = headers.get('x-hub-signature-256');
    if (header === null || !header.startsWith('sha256=')) return false;

    const delivered = Buffer.from(header.slice('sha256='.length), 'hex');
    const expected = createHmac('sha256', secret).update(body).digest();

    return delivered.length === expected.length && timingSafeEqual(delivered, expected);
  },
  parsePullRequest(body) {
    const held = body as {
      pull_request?: {
        number?: unknown;
        html_url?: unknown;
        title?: unknown;
        state?: unknown;
        draft?: unknown;
        merged?: unknown;
        merged_at?: unknown;
        head?: { ref?: unknown; sha?: unknown };
        user?: { login?: unknown };
      };
      repository?: { name?: unknown; owner?: { login?: unknown } };
    };
    const pull = held?.pull_request;
    const repo = held?.repository;
    if (
      typeof pull?.number !== 'number' ||
      typeof pull.html_url !== 'string' ||
      typeof pull.title !== 'string' ||
      typeof repo?.name !== 'string' ||
      typeof repo.owner?.login !== 'string'
    ) {
      return null;
    }

    return {
      owner: repo.owner.login,
      name: repo.name,
      number: pull.number,
      title: pull.title,
      state: stateOf(pull),
      url: pull.html_url,
      branch: typeof pull.head?.ref === 'string' ? pull.head.ref : null,
      headSha: typeof pull.head?.sha === 'string' ? pull.head.sha : '',
      authorLogin: typeof pull.user?.login === 'string' ? pull.user.login : null,
      mergedAt: typeof pull.merged_at === 'string' ? pull.merged_at : null,
    };
  },
};

function stateOf(pull: {
  state?: unknown;
  draft?: unknown;
  merged?: unknown;
}): PullRequestEvent['state'] {
  if (pull.merged === true) return 'merged';
  if (pull.state === 'closed') return 'closed';
  if (pull.draft === true) return 'draft';

  return 'open';
}

const PROVIDERS: Record<string, GitProvider> = { [github.kind]: github };

/* ── The routes ───────────────────────────────────────────────────────────── */

const REPOSITORY = t.Object({
  id: t.String(),
  projectId: t.String(),
  provider: t.String(),
  owner: t.String(),
  name: t.String(),
  defaultBranch: t.String(),
});

const PULL_REQUEST = t.Object({
  id: t.String(),
  ticketId: t.String(),
  provider: t.String(),
  number: t.Integer(),
  title: t.String(),
  state: t.String(),
  url: t.String(),
  branch: t.Union([t.String(), t.Null()]),
  authorLogin: t.Union([t.String(), t.Null()]),
  mergedAt: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
});

type Asking = { readonly refused: ReturnType<typeof refusal> } | { readonly user: HeldUser };

export function createGit({
  auth,
  config,
  database,
}: {
  auth: Auth;
  config: Config;
  database: Database;
}) {
  return new Elysia()
    .post(
      '/api/webhooks/github',
      async ({ request, status }) => {
        const secret = config.git.webhookSecret;
        // Unconfigured is refused rather than treated as "trust anything".
        if (secret === null) return status(404, refusal('GIT_DISABLED', messages.gitDisabled));

        const body = new Uint8Array(await request.arrayBuffer());
        if (!github.verifySignature(secret, request.headers, body)) {
          return status(401, refusal('GIT_SIGNATURE_INVALID', messages.gitSignatureInvalid));
        }
        if (github.eventKind(request.headers) !== 'pull_request') return { received: true };

        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder().decode(body));
        } catch {
          return status(400, refusal('GIT_PAYLOAD_INVALID', messages.gitPayloadInvalid));
        }

        const event = github.parsePullRequest(payload);
        if (event === null) return { received: true };

        await mirror(database, event);

        return { received: true };
      },
      {
        response: {
          200: t.Object({ received: t.Boolean() }),
          400: REFUSAL,
          401: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'A GitHub delivery: a pull request linked to its ticket' },
      },
    )
    .get(
      '/api/projects/:ref/repositories',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await projectByRef(database, params.ref);
        if (!found) return status(404, refusal('PROJECT_NOT_FOUND', messages.projectNotFound));

        const rows = await database
          .select()
          .from(repository)
          .where(eq(repository.projectId, found.id))
          .orderBy(asc(repository.createdAt), asc(repository.id));

        return { repositories: rows.map(asRepository) };
      },
      {
        params: t.Object({ ref: t.String() }),
        response: {
          200: t.Object({ repositories: t.Array(REPOSITORY) }),
          401: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'The repositories a project’s work happens in' },
      },
    )
    .post(
      '/api/projects/:ref/repositories',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await projectByRef(database, params.ref);
        if (!found) return status(404, refusal('PROJECT_NOT_FOUND', messages.projectNotFound));

        const owner = body.owner.trim();
        const name = body.name.trim();
        if (owner === '' || name === '') {
          return status(
            400,
            refusal('REPOSITORY_REMOTE_REQUIRED', messages.repositoryRemoteRequired),
          );
        }
        const provider = body.provider ?? 'github';
        if (!(provider in PROVIDERS)) {
          return status(
            400,
            refusal('REPOSITORY_PROVIDER_UNKNOWN', messages.repositoryProviderUnknown),
          );
        }

        const made = {
          id: randomUUID(),
          projectId: found.id,
          provider,
          owner,
          name,
          defaultBranch: body.defaultBranch?.trim() || 'main',
        };

        try {
          await database.insert(repository).values(made);
        } catch (error) {
          if (postgresCode(error) === '23505') {
            return status(
              409,
              refusal('REPOSITORY_EXISTS', messages.repositoryExists(owner, name)),
            );
          }
          throw error;
        }

        return { repository: asRepository({ ...made, createdAt: new Date() }) };
      },
      {
        params: t.Object({ ref: t.String() }),
        body: t.Object({
          owner: t.String(),
          name: t.String(),
          provider: t.Optional(t.String()),
          defaultBranch: t.Optional(t.String()),
        }),
        response: {
          200: t.Object({ repository: REPOSITORY }),
          400: REFUSAL,
          401: REFUSAL,
          404: REFUSAL,
          409: REFUSAL,
        },
        detail: { summary: 'Attach a repository to a project' },
      },
    )
    .delete(
      '/api/projects/:ref/repositories/:id',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await projectByRef(database, params.ref);
        if (!found) return status(404, refusal('PROJECT_NOT_FOUND', messages.projectNotFound));

        const [removed] = await database
          .delete(repository)
          .where(and(eq(repository.id, params.id), eq(repository.projectId, found.id)))
          .returning({ id: repository.id });
        if (!removed)
          return status(404, refusal('REPOSITORY_NOT_FOUND', messages.repositoryNotFound));

        return { repository: null };
      },
      {
        params: t.Object({ ref: t.String(), id: t.String() }),
        response: { 200: t.Object({ repository: t.Null() }), 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Take a repository off a project' },
      },
    )
    .get(
      '/api/tickets/:ref/pull-requests',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const found = await resolveTicket(database, params.ref);
        if (!found) return status(404, refusal('TICKET_NOT_FOUND', messages.ticketNotFound));

        const rows = await database
          .select()
          .from(ticketPullRequest)
          .where(eq(ticketPullRequest.ticketId, found.id))
          .orderBy(asc(ticketPullRequest.createdAt), asc(ticketPullRequest.id));

        return { pullRequests: rows.map(asPullRequest) };
      },
      {
        params: t.Object({ ref: t.String() }),
        response: {
          200: t.Object({ pullRequests: t.Array(PULL_REQUEST) }),
          401: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'The pull requests reviewing a ticket' },
      },
    );
}

/* ── Mirroring a delivery ─────────────────────────────────────────────────── */

/**
 * Record a pull request against the ticket it names, and act on a merge.
 *
 * A delivery for a repository no project watches is ignored: the project's list
 * of repositories is what scopes every other project out. A pull request that
 * names no ticket is ignored too, because a row is always a ticket's.
 */
async function mirror(database: Database, event: PullRequestEvent): Promise<void> {
  const [watched] = await database
    .select()
    .from(repository)
    .where(
      and(
        eq(repository.provider, github.kind),
        sql`lower(${repository.owner}) = lower(${event.owner})`,
        sql`lower(${repository.name}) = lower(${event.name})`,
      ),
    );
  if (!watched) return;

  const [existing] = await database
    .select()
    .from(ticketPullRequest)
    .where(
      and(
        eq(ticketPullRequest.repositoryId, watched.id),
        eq(ticketPullRequest.number, event.number),
      ),
    );

  const ticket_ = existing
    ? { id: existing.ticketId }
    : await namingTicket(database, watched.projectId, event);
  if (ticket_ === null) return;

  const mergedAt = event.mergedAt === null ? null : new Date(event.mergedAt);
  const updatedAt = new Date();
  const values = {
    ticketId: ticket_.id,
    repositoryId: watched.id,
    provider: github.kind,
    number: event.number,
    title: event.title,
    state: event.state,
    url: event.url,
    branch: event.branch,
    headSha: event.headSha,
    authorLogin: event.authorLogin,
    mergedAt,
    updatedAt,
  };

  if (existing) {
    await database
      .update(ticketPullRequest)
      .set(values)
      .where(eq(ticketPullRequest.id, existing.id));
  } else {
    await database.insert(ticketPullRequest).values({ id: randomUUID(), ...values });
    await recordActivity(database, [
      {
        ticketId: ticket_.id,
        actorId: null,
        actorKind: 'system',
        action: 'pull_request_linked',
        details: { number: event.number, url: event.url },
      },
    ]);
  }

  const [ticketRow] = await database.select().from(ticket).where(eq(ticket.id, ticket_.id));
  if (!ticketRow) return;

  const becomingMerged = event.state === 'merged' && existing?.state !== 'merged';
  const status = becomingMerged && ticketRow.status === 'needs-review' ? 'done' : ticketRow.status;

  await database
    .update(ticket)
    .set({ pullRequestUrl: event.url, status, updatedAt })
    .where(eq(ticket.id, ticket_.id));

  if (becomingMerged) {
    await recordActivity(database, [
      {
        ticketId: ticket_.id,
        actorId: null,
        actorKind: 'system',
        action: 'pull_request_merged',
        details: { number: event.number, url: event.url },
      },
    ]);
  }
}

/** The ticket a pull request names in its title or branch, or null when it names none. */
async function namingTicket(
  database: Database,
  projectId: string,
  event: PullRequestEvent,
): Promise<{ id: string } | null> {
  for (const said of identifiers(event.title, event.branch)) {
    const [found] = await database.select().from(project).where(eq(project.prefix, said.prefix));
    if (!found || found.id !== projectId) continue;

    const [named] = await database
      .select({ id: ticket.id })
      .from(ticket)
      .where(and(eq(ticket.projectId, found.id), eq(ticket.number, said.number)));
    if (named) return named;
  }

  return null;
}

/** Every `PREFIX-12` a pull request's words name, title first. */
function identifiers(...parts: readonly (string | null)[]): { prefix: string; number: number }[] {
  const found: { prefix: string; number: number }[] = [];

  for (const part of parts) {
    if (part === null) continue;
    for (const match of part.matchAll(/\b([A-Za-z][A-Za-z0-9]{1,5})-(\d+)\b/g)) {
      found.push({ prefix: match[1]!.toUpperCase(), number: Number(match[2]!) });
    }
  }

  return found;
}

/* ── Reads and helpers ────────────────────────────────────────────────────── */

function asRepository(row: typeof repository.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    provider: row.provider,
    owner: row.owner,
    name: row.name,
    defaultBranch: row.defaultBranch,
  };
}

function asPullRequest(row: typeof ticketPullRequest.$inferSelect) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    provider: row.provider,
    number: row.number,
    title: row.title,
    state: row.state,
    url: row.url,
    branch: row.branch,
    authorLogin: row.authorLogin,
    mergedAt: row.mergedAt === null ? null : row.mergedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function projectByRef(database: Database, ref: string) {
  const [byId] = await database.select().from(project).where(eq(project.id, ref));
  if (byId) return byId;

  const [byPrefix] = await database
    .select()
    .from(project)
    .where(eq(project.prefix, ref.trim().toUpperCase()));

  return byPrefix ?? null;
}

async function resolveTicket(database: Database, ref: string) {
  const [byId] = await database.select().from(ticket).where(eq(ticket.id, ref));
  if (byId) return byId;

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

  return found ?? null;
}

async function asking(auth: Auth, request: Request): Promise<Asking> {
  const held = await keyHolder(auth, request);
  if ('refusal' in held) return { refused: refusal(held.refusal.code, held.refusal.message) };

  return { user: held.user };
}

function postgresCode(error: unknown): string | null {
  let at: unknown = error;

  for (let depth = 0; depth < 5 && at !== undefined && at !== null; depth += 1) {
    const code = (at as { code?: unknown }).code;
    if (typeof code === 'string') return code;

    at = (at as { cause?: unknown }).cause;
  }

  return null;
}
