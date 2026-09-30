import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Config } from './config';
import type { Database } from './database';
import { recentPoolAudit } from './pool-audit';
import { recordPoolAudit } from './pool-audit';
import { REFUSAL, refusal } from './refusals';

type ManagementState = 'unconfigured' | 'rejected' | 'unavailable' | 'ready';

interface Cooldown {
  scope?: string;
  model_key?: string;
  reason?: string;
  retry_at?: string;
  remaining_seconds?: number;
  backoff_level?: number;
  http_status?: number;
}

interface Credential {
  id: string;
  name: string | null;
  provider: string | null;
  label: string | null;
  email: string | null;
  status: string | null;
  disabled: boolean;
  unavailable: boolean;
  nextRetryAfter: string | null;
  cooldowns: Cooldown[];
  quota: Record<string, string | number> | null;
}

const COOLDOWN_FIELDS = [
  'scope',
  'model_key',
  'reason',
  'retry_at',
  'remaining_seconds',
  'backoff_level',
  'http_status',
] as const;
const managementRejected = new WeakSet<Config>();
type OAuthProvider = 'codex' | 'claude';
type ManagementCall =
  | { kind: 'ok'; response: Response }
  | { kind: 'unconfigured' | 'rejected' | 'unavailable' };

export function createPoolManagement({
  auth,
  config,
  database,
}: {
  auth: Auth;
  config: Config;
  database: Database;
}) {
  return new Elysia().group('/api/admin/pool', (app) =>
    app
      .guard({
        beforeHandle: async ({ request, status }) => {
          const session = await auth.api.getSession({ headers: request.headers });
          if (session === null) {
            return status(
              401,
              refusal('NOT_SIGNED_IN', "This route is the console's; sign in to the console."),
            );
          }
          if ((session.user as { role?: string | null }).role !== 'admin') {
            return status(
              403,
              refusal('NOT_AN_ADMIN', 'Only an administrator can manage the shared pool.'),
            );
          }
        },
      })
      .get(
        '/',
        async () => {
          const result = await credentials(config);
          return result;
        },
        {
          response: {
            200: t.Object({
              status: t.Union([
                t.Literal('ready'),
                t.Literal('unconfigured'),
                t.Literal('rejected'),
                t.Literal('unavailable'),
              ]),
              credentials: t.Array(
                t.Object({
                  id: t.String(),
                  name: t.Nullable(t.String()),
                  provider: t.Nullable(t.String()),
                  label: t.Nullable(t.String()),
                  email: t.Nullable(t.String()),
                  status: t.Nullable(t.String()),
                  disabled: t.Boolean(),
                  unavailable: t.Boolean(),
                  nextRetryAfter: t.Nullable(t.String()),
                  cooldowns: t.Array(t.Any()),
                  quota: t.Nullable(t.Record(t.String(), t.Union([t.String(), t.Number()]))),
                }),
              ),
            }),
            401: REFUSAL,
            403: REFUSAL,
          },
          detail: { summary: 'Read safe live health for shared provider credentials' },
        },
      )
      .get(
        '/audit',
        async () => ({ events: await recentPoolAudit(database) }),
        {
          detail: { summary: 'Read recent safe audit events for Pool management' },
        },
      )
      .post(
        '/oauth',
        async ({ body, request }) => {
          const path = body.provider === 'codex' ? 'codex-auth-url' : 'anthropic-auth-url';
          const result = await managementRequest(config, path);
          if (result.kind !== 'ok' || !result.response.ok) {
            if (result.kind === 'ok') await result.response.body?.cancel();
            await recordOAuthAttempt(database, auth, request, body.provider, 'failed', 'Provider login could not be started');
            return { status: result.kind === 'ok' ? 'unavailable' : result.kind };
          }

          let answer: { url?: unknown; state?: unknown };
          try {
            answer = (await result.response.json()) as { url?: unknown; state?: unknown };
          } catch {
            await recordOAuthAttempt(database, auth, request, body.provider, 'failed', 'Provider login could not be started');
            return { status: 'unavailable' as const };
          }
          if (typeof answer.url !== 'string' || typeof answer.state !== 'string' || answer.state === '') {
            await recordOAuthAttempt(database, auth, request, body.provider, 'failed', 'Provider login could not be started');
            return { status: 'unavailable' as const };
          }

          await recordOAuthAttempt(database, auth, request, body.provider, 'succeeded', 'Authorization started');
          return { status: 'pending' as const, provider: body.provider, url: answer.url, state: answer.state };
        },
        {
          body: t.Object({ provider: t.Union([t.Literal('codex'), t.Literal('claude')]) }),
          detail: { summary: 'Start a provider OAuth login' },
        },
      )
      .post(
        '/oauth/callback',
        async ({ body, request, status }) => {
          if (!validCallback(body.redirectUrl)) {
            return status(400, refusal('INVALID_CALLBACK', 'Paste the localhost callback address returned by the provider.'));
          }
          const result = await managementRequest(config, 'oauth-callback', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: body.provider === 'claude' ? 'anthropic' : 'codex', redirect_url: body.redirectUrl }),
          });
          if (result.kind !== 'ok' || !result.response.ok) {
            if (result.kind === 'ok') await result.response.body?.cancel();
            await recordOAuthAttempt(database, auth, request, body.provider, 'failed', 'Callback was not accepted');
            return { status: result.kind === 'ok' ? 'unavailable' : result.kind };
          }

          await result.response.body?.cancel();
          await recordOAuthAttempt(database, auth, request, body.provider, 'succeeded', 'Callback relayed');
          return { status: 'accepted' as const };
        },
        {
          body: t.Object({
            provider: t.Union([t.Literal('codex'), t.Literal('claude')]),
            redirectUrl: t.String({ minLength: 1, maxLength: 4096 }),
          }),
          detail: { summary: 'Relay a pasted localhost OAuth callback without storing it' },
        },
      )
      .get(
        '/oauth/status',
        async ({ query }) => {
          if (!validState(query.state)) return { status: 'expired' as const };
          const result = await managementRequest(config, `get-auth-status?${new URLSearchParams({ state: query.state })}`);
          if (result.kind !== 'ok') return { status: result.kind };
          if (!result.response.ok) {
            await result.response.body?.cancel();
            return { status: 'unavailable' as const };
          }
          let body: { status?: unknown; error?: unknown };
          try {
            body = (await result.response.json()) as { status?: unknown; error?: unknown };
          } catch {
            return { status: 'unavailable' as const };
          }
          if (body.status === 'wait') return { status: 'pending' as const };
          if (body.status === 'ok') return { status: 'succeeded' as const };
          if (body.status === 'error') {
            return {
              status: typeof body.error === 'string' && body.error.includes('unknown or expired')
                ? 'expired' as const
                : 'failed' as const,
            };
          }
          return { status: 'unavailable' as const };
        },
        {
          query: t.Object({ state: t.String() }),
          detail: { summary: 'Poll a provider OAuth login held by CLIProxyAPI' },
        },
      )
      .delete(
        '/oauth',
        async ({ query }) => {
          if (!validState(query.state)) return { status: 'expired' as const };
          const result = await managementRequest(
            config,
            `oauth-session?${new URLSearchParams({ state: query.state })}`,
            { method: 'DELETE' },
          );
          if (result.kind !== 'ok') return { status: result.kind };
          if (!result.response.ok) {
            await result.response.body?.cancel();
            return { status: 'unavailable' as const };
          }
          let body: { cancelled?: unknown };
          try {
            body = (await result.response.json()) as { cancelled?: unknown };
          } catch {
            return { status: 'unavailable' as const };
          }
          return { status: body.cancelled === true ? 'cancelled' as const : 'expired' as const };
        },
        {
          query: t.Object({ state: t.String() }),
          detail: { summary: 'Cancel a pending provider OAuth login' },
        },
      ),
  );
}

async function credentials(config: Config): Promise<{ status: ManagementState; credentials: Credential[] }> {
  const result = await managementRequest(config, 'auth-files');
  if (result.kind !== 'ok') return { status: result.kind, credentials: [] };
  const { response } = result;

  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    return { status: 'rejected', credentials: [] };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { status: 'unavailable', credentials: [] };
  }

  try {
    const body = (await response.json()) as { files?: unknown };
    const files = Array.isArray(body.files) ? body.files : [];
    return { status: 'ready', credentials: files.map(credentialOf).filter(isCredential) };
  } catch {
    return { status: 'unavailable', credentials: [] };
  }
}

async function managementRequest(
  config: Config,
  path: string,
  init: RequestInit = {},
  { authenticated = true }: { authenticated?: boolean } = {},
): Promise<ManagementCall> {
  if (managementRejected.has(config)) return { kind: 'rejected' };
  if (!config.pool.managementKey) return { kind: 'unconfigured' };

  const headers = new Headers(init.headers);
  if (authenticated) headers.set('authorization', `Bearer ${config.pool.managementKey}`);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${config.pool.url.replace(/\/+$/, '')}/v0/management/${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return { kind: 'unavailable' };
  }

  if (authenticated && (response.status === 401 || response.status === 403)) {
    managementRejected.add(config);
    await response.body?.cancel();
    return { kind: 'rejected' };
  }
  return { kind: 'ok', response };
}

function validState(state: string): boolean {
  return state.length > 0 && state.length <= 512;
}

function validCallback(callback: string): boolean {
  try {
    const url = new URL(callback);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname) &&
      validState(url.searchParams.get('state') ?? '') &&
      (Boolean(url.searchParams.get('code')) || Boolean(url.searchParams.get('error')))
    );
  } catch {
    return false;
  }
}

async function recordOAuthAttempt(
  database: Database,
  auth: Auth,
  request: Request,
  provider: OAuthProvider,
  outcome: 'succeeded' | 'failed',
  detail: string,
) {
  const session = await auth.api.getSession({ headers: request.headers });
  await recordPoolAudit(database, {
    actorId: session?.user.id ?? null,
    actorLabel: session?.user.email ?? 'Kira admin',
    action: 'login',
    provider,
    credentialLabel: null,
    outcome,
    detail,
  });
}

function credentialOf(raw: unknown): Credential | null {
  if (raw === null || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const index = item.auth_index;
  if (typeof index !== 'string' && typeof index !== 'number') return null;
  return {
    id: String(index),
    name: optionalString(item.name),
    provider: optionalString(item.provider) ?? optionalString(item.type),
    label: optionalString(item.label),
    email: optionalString(item.email),
    status: optionalString(item.status),
    disabled: item.disabled === true,
    unavailable: item.unavailable === true,
    nextRetryAfter: optionalString(item.next_retry_after),
    cooldowns: Array.isArray(item.cooldowns)
      ? item.cooldowns.map(cooldownOf).filter((value): value is Cooldown => value !== null)
      : [],
    quota: quotaOf(item.quota),
  };
}

function cooldownOf(raw: unknown): Cooldown | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const cooldown: Cooldown = {};
  for (const key of COOLDOWN_FIELDS) {
    const field = value[key];
    if (typeof field === 'string' || typeof field === 'number') cooldown[key] = field as never;
  }
  return cooldown;
}

function quotaOf(raw: unknown): Record<string, string | number> | null {
  if (raw === null || typeof raw !== 'object') return null;
  const signals = (raw as { signals?: unknown }).signals;
  if (signals === null || typeof signals !== 'object') return null;
  return Object.fromEntries(
    Object.entries(signals).filter(
      (entry): entry is [string, string | number] =>
        typeof entry[1] === 'string' || typeof entry[1] === 'number',
    ),
  );
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function isCredential(value: Credential | null): value is Credential {
  return value !== null;
}
