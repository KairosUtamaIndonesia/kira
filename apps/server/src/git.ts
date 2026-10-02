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
import { createHmac, createSign, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Config } from './config';
import type { Database } from './database';
import { recordActivity } from './activity';
import { keyHolder, type HeldUser } from './keys';
import { refusal, REFUSAL } from './refusals';
import { messages } from './messages';
import { loadKey, open, seal } from './secretbox';
import {
  gitConnection,
  project,
  pullRequestCheck,
  repository,
  ticket,
  ticketPullRequest,
} from './schema';

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

/** A check a host reported, normalized so the rollup is provider-independent. */
interface CheckEvent {
  owner: string;
  name: string;
  /** The pull request's number when the host names one; otherwise resolved by SHA. */
  number: number | null;
  headSha: string;
  /** The check's own name, which is what a failed one is reported under. */
  context: string;
  state: 'pending' | 'passed' | 'failed' | 'neutral';
}

interface GitProvider {
  kind: string;
  /** What the host says the delivery is, from its own headers. */
  eventKind(headers: Headers): 'pull_request' | 'checks' | 'other';
  /** Whether the delivery is signed with `secret` over the raw body. */
  verifySignature(secret: string, headers: Headers, body: Uint8Array): boolean;
  /** The pull request a delivery carries, or null when it is not one. */
  parsePullRequest(body: unknown): PullRequestEvent | null;
  /** The check a delivery carries, or null when it is not one. */
  parseCheck(body: unknown): CheckEvent | null;
}

/** GitHub: HMAC-SHA256 over the raw body, `X-Hub-Signature-256`, `X-GitHub-Event`. */
const github: GitProvider = {
  kind: 'github',
  eventKind: (headers) => {
    const event = headers.get('x-github-event');
    if (event === 'pull_request') return 'pull_request';
    if (event === 'check_run' || event === 'status') return 'checks';

    return 'other';
  },
  verifySignature(secret, headers, body) {
    const header = headers.get('x-hub-signature-256');
    if (header === null || !header.startsWith('sha256=')) return false;

    const delivered = hexDigest(header.slice('sha256='.length));
    if (delivered === null) return false;

    return sameBytes(delivered, sign(secret, body));
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
  parseCheck(body) {
    const held = body as {
      check_run?: {
        name?: unknown;
        status?: unknown;
        conclusion?: unknown;
        head_sha?: unknown;
        pull_requests?: { number?: unknown }[];
        check_suite?: { head_sha?: unknown };
      };
      state?: unknown;
      sha?: unknown;
      context?: unknown;
      repository?: { name?: unknown; owner?: { login?: unknown } };
    };
    const repo = held?.repository;
    if (typeof repo?.name !== 'string' || typeof repo.owner?.login !== 'string') return null;

    const run = held.check_run;
    if (run !== undefined) {
      if (typeof run.name !== 'string') return null;

      const headSha =
        typeof run.head_sha === 'string'
          ? run.head_sha
          : typeof run.check_suite?.head_sha === 'string'
            ? run.check_suite.head_sha
            : '';
      if (headSha === '') return null;

      return {
        owner: repo.owner.login,
        name: repo.name,
        number: firstNumber(run.pull_requests),
        headSha,
        context: run.name,
        state: checkState(run.status, run.conclusion),
      };
    }

    // A commit status names no pull request, so it is resolved by SHA.
    if (typeof held.sha === 'string' && held.sha !== '' && typeof held.state === 'string') {
      return {
        owner: repo.owner.login,
        name: repo.name,
        number: null,
        headSha: held.sha,
        context: typeof held.context === 'string' && held.context !== '' ? held.context : 'status',
        state: statusState(held.state),
      };
    }

    return null;
  },
};

function firstNumber(pulls: { number?: unknown }[] | undefined): number | null {
  const found = Array.isArray(pulls)
    ? pulls.find((each) => typeof each?.number === 'number')
    : undefined;

  return typeof found?.number === 'number' ? found.number : null;
}

/** A check's state from GitHub's status/conclusion pair. */
function checkState(status: unknown, conclusion: unknown): CheckEvent['state'] {
  if (status !== 'completed') return 'pending';
  if (conclusion === 'success') return 'passed';
  if (conclusion === 'neutral' || conclusion === 'skipped') return 'neutral';

  return 'failed';
}

/** A commit-status state, which GitHub, Gitea and Forgejo spell the same way. */
function statusState(state: unknown): CheckEvent['state'] {
  if (state === 'success') return 'passed';
  if (state === 'pending' || state === 'running') return 'pending';
  if (state === 'error' || state === 'failure') return 'failed';

  return 'neutral';
}

/** A GitLab pipeline's state. */
function pipelineState(state: unknown): CheckEvent['state'] {
  if (state === 'success') return 'passed';
  if (state === 'failed' || state === 'canceled') return 'failed';
  if (state === 'skipped' || state === 'manual') return 'neutral';

  return 'pending';
}

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

/**
 * Forgejo and Gitea: wire-identical to each other, HMAC-SHA256 over the raw body
 * with `X-Gitea-Signature` and `X-Gitea-Event`. Their payload shape matches
 * GitHub's closely enough that the pull-request parser is shared.
 */
function giteaFamily(kind: 'forgejo' | 'gitea'): GitProvider {
  return {
    kind,
    eventKind: (headers) => {
      const event = headers.get('x-gitea-event');
      if (event === 'pull_request') return 'pull_request';
      if (event === 'status') return 'checks';

      return 'other';
    },
    verifySignature(secret, headers, body) {
      const header = headers.get('x-gitea-signature');
      if (header === null) return false;

      const delivered = hexDigest(header.replace(/^sha256=/, ''));
      if (delivered === null) return false;

      return sameBytes(delivered, sign(secret, body));
    },
    parsePullRequest: (body) => github.parsePullRequest(body),
    parseCheck(body) {
      const held = body as {
        sha?: unknown;
        state?: unknown;
        context?: unknown;
        name?: unknown;
        repository?: { name?: unknown; owner?: { login?: unknown } };
      };
      const repo = held?.repository;
      if (
        typeof held?.sha !== 'string' ||
        held.sha === '' ||
        typeof held.state !== 'string' ||
        typeof repo?.name !== 'string' ||
        typeof repo.owner?.login !== 'string'
      ) {
        return null;
      }

      return {
        owner: repo.owner.login,
        name: repo.name,
        number: null,
        headSha: held.sha,
        context:
          typeof held.context === 'string' && held.context !== ''
            ? held.context
            : typeof held.name === 'string'
              ? held.name
              : 'status',
        state: statusState(held.state),
      };
    },
  };
}

/**
 * GitLab: a plaintext `X-Gitlab-Token` compare, `X-Gitlab-Event`, and merge
 * requests, whose path carries the owner and name.
 */
const gitlab: GitProvider = {
  kind: 'gitlab',
  eventKind: (headers) => {
    const event = headers.get('x-gitlab-event');
    if (event === 'Merge Request Hook') return 'pull_request';
    if (event === 'Pipeline Hook') return 'checks';

    return 'other';
  },
  verifySignature(secret, headers) {
    const presented = headers.get('x-gitlab-token');

    return presented !== null && sameBytes(Buffer.from(presented), Buffer.from(secret));
  },
  parsePullRequest(body) {
    const held = body as {
      object_attributes?: {
        iid?: unknown;
        url?: unknown;
        title?: unknown;
        state?: unknown;
        action?: unknown;
        source_branch?: unknown;
        last_commit?: { id?: unknown };
        author?: { username?: unknown };
        merged_at?: unknown;
        draft?: unknown;
        work_in_progress?: unknown;
      };
      project?: { name?: unknown; path_with_namespace?: unknown };
    };
    const request = held?.object_attributes;
    const path =
      typeof held?.project?.path_with_namespace === 'string'
        ? held.project.path_with_namespace
        : null;
    if (
      typeof request?.iid !== 'number' ||
      typeof request.url !== 'string' ||
      typeof request.title !== 'string' ||
      path === null
    ) {
      return null;
    }

    const [owner, ...rest] = path.split('/');
    const name = rest.join('/');
    if (owner === undefined || owner === '' || name === '') return null;

    const merged = request.state === 'merged' || request.action === 'merge';

    return {
      owner,
      name,
      number: request.iid,
      title: request.title,
      state: merged
        ? 'merged'
        : request.state === 'closed'
          ? 'closed'
          : request.draft === true || request.work_in_progress === true
            ? 'draft'
            : 'open',
      url: request.url,
      branch: typeof request.source_branch === 'string' ? request.source_branch : null,
      headSha: typeof request.last_commit?.id === 'string' ? request.last_commit.id : '',
      authorLogin: typeof request.author?.username === 'string' ? request.author.username : null,
      mergedAt: typeof request.merged_at === 'string' ? request.merged_at : null,
    };
  },
  parseCheck(body) {
    const held = body as {
      object_attributes?: { sha?: unknown; status?: unknown };
      merge_request?: { iid?: unknown } | null;
      project?: { path_with_namespace?: unknown };
    };
    const attributes = held?.object_attributes;
    const path =
      typeof held?.project?.path_with_namespace === 'string'
        ? held.project.path_with_namespace
        : null;
    if (
      typeof attributes?.sha !== 'string' ||
      attributes.sha === '' ||
      typeof attributes.status !== 'string' ||
      path === null
    ) {
      return null;
    }

    const [owner, ...rest] = path.split('/');
    const name = rest.join('/');
    if (owner === undefined || owner === '' || name === '') return null;

    const iid = held.merge_request?.iid;

    return {
      owner,
      name,
      number: typeof iid === 'number' ? iid : null,
      headSha: attributes.sha,
      context: 'pipeline',
      state: pipelineState(attributes.status),
    };
  },
};

function sign(secret: string, body: Uint8Array): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

function sameBytes(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * A 64-character SHA-256 digest, or null when the text is not one.
 *
 * `Buffer.from(text, 'hex')` silently stops at the first character that is not a
 * hex digit, so `"<a real digest>x"` would decode to the real digest and compare
 * equal. Validating the whole string first is what keeps a tampered signature or
 * state from passing on its valid prefix.
 */
function hexDigest(value: string): Buffer | null {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) return null;

  return Buffer.from(value, 'hex');
}

/**
 * A GitHub install state: a nonce and its HMAC, so the callback can trust that
 * the install it is being told about is one this server started.
 */
function signState(secret: string, nonce: string): string {
  const mac = createHmac('sha256', secret).update(nonce).digest('hex');

  return `${nonce}.${mac}`;
}

function verifyState(secret: string, state: string): string | null {
  const [nonce, mac] = state.split('.');
  if (nonce === undefined || mac === undefined || nonce === '' || mac === '') return null;

  const delivered = hexDigest(mac);
  if (delivered === null) return null;

  const expected = createHmac('sha256', secret).update(nonce).digest();

  return sameBytes(delivered, expected) ? nonce : null;
}

/** A GitHub App JWT: RS256, under ten minutes, as GitHub requires. */
function signAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const signing = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iat: now - 60,
    exp: now + 540,
    iss: appId,
  })}`;
  const signature = createSign('RSA-SHA256').update(signing).sign(privateKey);

  return `${signing}.${signature.toString('base64url')}`;
}

const PROVIDERS: Record<string, GitProvider> = {
  [github.kind]: github,
  forgejo: giteaFamily('forgejo'),
  gitea: giteaFamily('gitea'),
  gitlab,
};

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
  checks: t.Array(t.Object({ context: t.String(), state: t.String() })),
  checksState: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const CONNECTION = t.Object({
  id: t.String(),
  provider: t.String(),
  authKind: t.String(),
  instanceUrl: t.Union([t.String(), t.Null()]),
  accountLogin: t.String(),
  accountType: t.String(),
  createdAt: t.String(),
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
  const key = loadKey(config.git.secretKey);

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

        const kind = github.eventKind(request.headers);
        if (kind === 'other') return { received: true };

        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder().decode(body));
        } catch {
          return status(400, refusal('GIT_PAYLOAD_INVALID', messages.gitPayloadInvalid));
        }

        if (kind === 'pull_request') {
          const event = github.parsePullRequest(payload);
          if (event !== null) await mirror(database, github.kind, event);
        } else {
          const check = github.parseCheck(payload);
          if (check !== null) await applyCheck(database, github.kind, check);
        }

        return { received: true };
      },
      {
        response: {
          200: t.Object({ received: t.Boolean() }),
          400: REFUSAL,
          401: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'A GitHub delivery: a pull request or a check, linked to its ticket' },
      },
    )
    .post(
      '/api/webhooks/git/:connectionId',
      async ({ request, params, status }) => {
        const [connection] = await database
          .select()
          .from(gitConnection)
          .where(eq(gitConnection.id, params.connectionId));
        const provider = connection === undefined ? undefined : PROVIDERS[connection.provider];
        // Unknown, unconfigured and unreadable all answer the same way: no such
        // connection is watched, which is what a caller learns either way.
        if (
          connection === undefined ||
          provider === undefined ||
          key === null ||
          connection.webhookSecretEncrypted === null
        ) {
          return status(404, refusal('GIT_CONNECTION_UNKNOWN', messages.gitConnectionUnknown));
        }

        const secret = open(key, connection.webhookSecretEncrypted);
        if (secret === null) {
          return status(404, refusal('GIT_CONNECTION_UNKNOWN', messages.gitConnectionUnknown));
        }

        const body = new Uint8Array(await request.arrayBuffer());
        if (!provider.verifySignature(secret, request.headers, body)) {
          return status(401, refusal('GIT_SIGNATURE_INVALID', messages.gitSignatureInvalid));
        }

        const kind = provider.eventKind(request.headers);
        if (kind === 'other') return { received: true };

        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder().decode(body));
        } catch {
          return status(400, refusal('GIT_PAYLOAD_INVALID', messages.gitPayloadInvalid));
        }

        if (kind === 'pull_request') {
          const event = provider.parsePullRequest(payload);
          if (event !== null) await mirror(database, connection.provider, event);
        } else {
          const check = provider.parseCheck(payload);
          if (check !== null) await applyCheck(database, connection.provider, check);
        }

        return { received: true };
      },
      {
        params: t.Object({ connectionId: t.String() }),
        response: {
          200: t.Object({ received: t.Boolean() }),
          400: REFUSAL,
          401: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'A delivery from a connected host, for one connection' },
      },
    )
    .get(
      '/api/git/connections',
      async ({ request, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const rows = await database
          .select()
          .from(gitConnection)
          .orderBy(asc(gitConnection.createdAt), asc(gitConnection.id));

        return { connections: rows.map(asConnection) };
      },
      {
        response: {
          200: t.Object({ connections: t.Array(CONNECTION) }),
          401: REFUSAL,
        },
        detail: { summary: 'The Git hosts this server is connected to' },
      },
    )
    .post(
      '/api/git/connections',
      async ({ request, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);
        if (!(await isAdmin(auth, held.user.id))) {
          return status(403, refusal('NOT_AN_ADMIN', messages.notAnAdmin));
        }

        const provider = body.provider.trim();
        if (!(provider in PROVIDERS)) {
          return status(400, refusal('GIT_PROVIDER_UNKNOWN', messages.gitProviderUnknown));
        }
        if (key === null) {
          return status(400, refusal('GIT_KEY_MISSING', messages.gitKeyMissing));
        }

        const accessToken = body.accessToken.trim();
        if (accessToken === '') {
          return status(400, refusal('GIT_TOKEN_REQUIRED', messages.gitTokenRequired));
        }

        const instanceUrl = body.instanceUrl?.trim() ?? '';
        if (provider !== 'github' && !isHttpsUrl(instanceUrl)) {
          return status(400, refusal('GIT_INSTANCE_URL_INVALID', messages.gitInstanceUrlInvalid));
        }
        if (provider === 'github' && instanceUrl !== '' && !isHttpsUrl(instanceUrl)) {
          return status(400, refusal('GIT_INSTANCE_URL_INVALID', messages.gitInstanceUrlInvalid));
        }

        const webhookSecret = body.webhookSecret?.trim() || randomBytes(32).toString('hex');
        const made = {
          id: randomUUID(),
          provider,
          authKind: 'token',
          instanceUrl: instanceUrl === '' ? null : instanceUrl,
          accountLogin: body.accountLogin?.trim() || 'unknown',
          accountType: 'User',
          accessTokenEncrypted: seal(key, accessToken),
          webhookSecretEncrypted: seal(key, webhookSecret),
        };

        // A host is connected once, and the constraint is what says so rather
        // than a read that two administrators could both pass.
        const [connected] = await database
          .insert(gitConnection)
          .values(made)
          .onConflictDoNothing()
          .returning({ id: gitConnection.id });
        if (connected === undefined) {
          return status(409, refusal('GIT_CONNECTION_EXISTS', messages.gitConnectionExists));
        }

        return {
          connection: asConnection({
            ...made,
            installationId: null,
            updatedAt: new Date(),
            createdAt: new Date(),
          }),
          /** Shown once, because it is stored sealed and never read back out. */
          webhookSecret,
        };
      },
      {
        body: t.Object({
          provider: t.String(),
          instanceUrl: t.Optional(t.String()),
          accessToken: t.String(),
          webhookSecret: t.Optional(t.String()),
          accountLogin: t.Optional(t.String()),
        }),
        response: {
          200: t.Object({ connection: CONNECTION, webhookSecret: t.String() }),
          400: REFUSAL,
          401: REFUSAL,
          403: REFUSAL,
          409: REFUSAL,
        },
        detail: { summary: 'Connect a Git host with a token and receive its webhook secret' },
      },
    )
    .delete(
      '/api/git/connections/:id',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);
        if (!(await isAdmin(auth, held.user.id))) {
          return status(403, refusal('NOT_AN_ADMIN', messages.notAnAdmin));
        }

        const [removed] = await database
          .delete(gitConnection)
          .where(eq(gitConnection.id, params.id))
          .returning({ id: gitConnection.id });
        if (!removed) {
          return status(404, refusal('GIT_CONNECTION_UNKNOWN', messages.gitConnectionUnknown));
        }

        return { connection: null };
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: t.Object({ connection: t.Null() }),
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'Disconnect a Git host' },
      },
    )
    .get(
      '/api/git/github/connect',
      async ({ request, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);
        if (!(await isAdmin(auth, held.user.id))) {
          return status(403, refusal('NOT_AN_ADMIN', messages.notAnAdmin));
        }

        const slug = config.git.appSlug;
        if (slug === null || config.git.webhookSecret === null) {
          return { configured: false, url: null };
        }

        const state = signState(config.git.webhookSecret, randomBytes(16).toString('hex'));

        return {
          configured: true,
          url: `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`,
        };
      },
      {
        response: {
          200: t.Object({ configured: t.Boolean(), url: t.Union([t.String(), t.Null()]) }),
          401: REFUSAL,
          403: REFUSAL,
        },
        detail: { summary: 'The GitHub App install URL for this server, when one is configured' },
      },
    )
    .get(
      '/api/git/github/setup',
      async ({ query, status }) => {
        const secret = config.git.webhookSecret;
        if (secret === null) return status(404, refusal('GIT_DISABLED', messages.gitDisabled));
        if (verifyState(secret, query.state) === null) {
          return status(400, refusal('GIT_STATE_INVALID', messages.gitStateInvalid));
        }

        const installationId = Number(query.installation_id);
        if (!Number.isInteger(installationId) || installationId <= 0) {
          return status(400, refusal('GIT_INSTALLATION_INVALID', messages.gitInstallationInvalid));
        }

        const account = await githubInstallationAccount(config, installationId);
        const existing = await findAppConnection(database, installationId);

        if (existing) {
          await database
            .update(gitConnection)
            .set({ accountLogin: account.login, accountType: account.type, updatedAt: new Date() })
            .where(eq(gitConnection.id, existing.id));
        } else {
          await database.insert(gitConnection).values({
            id: randomUUID(),
            provider: 'github',
            authKind: 'app',
            instanceUrl: null,
            accountLogin: account.login,
            accountType: account.type,
            installationId,
          });
        }

        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Kira</title><p>GitHub is connected to Kira. You can close this window and return to the app.</p>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      },
      {
        query: t.Object({ installation_id: t.String(), state: t.String() }),
        detail: { summary: 'The GitHub App post-install callback' },
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

        // A repository is on a project once, and the constraint is what says so
        // rather than a read that two people could both pass.
        const [attached] = await database
          .insert(repository)
          .values(made)
          .onConflictDoNothing()
          .returning({ id: repository.id });
        if (attached === undefined) {
          return status(
            409,
            refusal('REPOSITORY_EXISTS', messages.repositoryExists(owner, name)),
          );
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

        const checks =
          rows.length === 0
            ? []
            : await database
                .select()
                .from(pullRequestCheck)
                .where(
                  inArray(
                    pullRequestCheck.pullRequestId,
                    rows.map((row) => row.id),
                  ),
                );

        const byPull = new Map<string, CheckRow[]>();
        for (const check of checks) {
          const group = byPull.get(check.pullRequestId) ?? [];
          group.push(check);
          byPull.set(check.pullRequestId, group);
        }

        return { pullRequests: rows.map((row) => asPullRequest(row, byPull.get(row.id) ?? [])) };
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
async function mirror(
  database: Database,
  provider: string,
  event: PullRequestEvent,
): Promise<void> {
  const [watched] = await database
    .select()
    .from(repository)
    .where(
      and(
        eq(repository.provider, provider),
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
    provider,
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

/**
 * Record a check against the pull request it belongs to.
 *
 * A delivery that names the pull request resolves by number; one that only names
 * a commit resolves by head SHA, which is the branch the checks ran on. A check
 * the host does not know about is ignored: a check is always a pull request's.
 */
async function applyCheck(database: Database, provider: string, event: CheckEvent): Promise<void> {
  const [watched] = await database
    .select()
    .from(repository)
    .where(
      and(
        eq(repository.provider, provider),
        sql`lower(${repository.owner}) = lower(${event.owner})`,
        sql`lower(${repository.name}) = lower(${event.name})`,
      ),
    );
  if (!watched) return;

  const [pull] =
    event.number === null
      ? await database
          .select()
          .from(ticketPullRequest)
          .where(
            and(
              eq(ticketPullRequest.repositoryId, watched.id),
              eq(ticketPullRequest.headSha, event.headSha),
            ),
          )
      : await database
          .select()
          .from(ticketPullRequest)
          .where(
            and(
              eq(ticketPullRequest.repositoryId, watched.id),
              eq(ticketPullRequest.number, event.number),
            ),
          );
  if (!pull) return;

  const updatedAt = new Date();
  await database
    .insert(pullRequestCheck)
    .values({
      id: randomUUID(),
      pullRequestId: pull.id,
      context: event.context,
      state: event.state,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [pullRequestCheck.pullRequestId, pullRequestCheck.context],
      set: { state: event.state, updatedAt },
    });
}

/** What a set of checks adds up to, or null when there are none. */
function checksRollup(checks: readonly CheckRow[]): string | null {
  if (checks.length === 0) return null;
  if (checks.some((check) => check.state === 'failed')) return 'failed';
  if (checks.some((check) => check.state === 'pending')) return 'pending';
  if (checks.some((check) => check.state === 'passed')) return 'passed';

  return 'neutral';
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

function asConnection(row: typeof gitConnection.$inferSelect) {
  return {
    id: row.id,
    provider: row.provider,
    authKind: row.authKind,
    instanceUrl: row.instanceUrl,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Whether a person holds the admin role, which connecting a host requires. */
async function isAdmin(auth: Auth, userId: string): Promise<boolean> {
  const context = await auth.$context;
  const found = await context.internalAdapter.findUserById(userId);

  return (found as { role?: string | null } | null)?.role === 'admin';
}

/** The account an installation belongs to, or a placeholder when it cannot be read. */
async function githubInstallationAccount(
  config: Config,
  installationId: number,
): Promise<{ login: string; type: string }> {
  const { appId, appPrivateKey } = config.git;
  if (appId === null || appPrivateKey === null) return { login: 'unknown', type: 'Organization' };

  try {
    const jwt = signAppJwt(appId, appPrivateKey.replace(/\\n/g, '\n'));
    const response = await fetch(`https://api.github.com/app/installations/${installationId}`, {
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'kira',
      },
    });
    if (!response.ok) return { login: 'unknown', type: 'Organization' };

    const body = (await response.json()) as { account?: { login?: unknown; type?: unknown } };

    return {
      login: typeof body.account?.login === 'string' ? body.account.login : 'unknown',
      type: typeof body.account?.type === 'string' ? body.account.type : 'Organization',
    };
  } catch {
    return { login: 'unknown', type: 'Organization' };
  }
}

async function findAppConnection(database: Database, installationId: number) {
  const [found] = await database
    .select()
    .from(gitConnection)
    .where(
      and(eq(gitConnection.provider, 'github'), eq(gitConnection.installationId, installationId)),
    );

  return found;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

type CheckRow = typeof pullRequestCheck.$inferSelect;

function asPullRequest(row: typeof ticketPullRequest.$inferSelect, checks: readonly CheckRow[]) {
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
    checks: checks
      .map((check) => ({ context: check.context, state: check.state }))
      .sort((left, right) => left.context.localeCompare(right.context)),
    checksState: checksRollup(checks),
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
