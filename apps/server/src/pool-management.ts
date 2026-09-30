import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Config } from './config';
import type { Database } from './database';
import { recentPoolAudit } from './pool-audit';
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
      ),
  );
}

async function credentials(config: Config): Promise<{ status: ManagementState; credentials: Credential[] }> {
  if (!config.pool.managementKey) return { status: 'unconfigured', credentials: [] };
  if (managementRejected.has(config)) return { status: 'rejected', credentials: [] };

  let response: Response;
  try {
    response = await fetch(`${config.pool.url}/v0/management/auth-files`, {
      headers: { authorization: `Bearer ${config.pool.managementKey}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return { status: 'unavailable', credentials: [] };
  }

  if (response.status === 401 || response.status === 403) {
    managementRejected.add(config);
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
