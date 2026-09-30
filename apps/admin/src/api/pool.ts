import { treaty } from '@elysiajs/eden';
import type { App } from '@kira/server/contract';
import { type Loaded, reasonFor } from './result';

const kira = treaty<App>(window.location.origin);

export interface PoolCredential {
  id: string;
  name: string | null;
  provider: string | null;
  label: string | null;
  email: string | null;
  status: string | null;
  disabled: boolean;
  unavailable: boolean;
  nextRetryAfter: string | null;
  cooldowns: {
    scope?: string;
    model_key?: string;
    reason?: string;
    retry_at?: string;
    remaining_seconds?: number;
    http_status?: number;
  }[];
  quota: Record<string, string | number> | null;
}

export interface PoolReading {
  status: 'ready' | 'unconfigured' | 'rejected' | 'unavailable';
  credentials: PoolCredential[];
}

export interface PoolAuditEvent {
  id: string;
  actorLabel: string;
  action: string;
  provider: string | null;
  credentialLabel: string | null;
  outcome: string;
  detail: string | null;
  createdAt: string;
}

export type OAuthProvider = 'codex' | 'claude';
export type OAuthState =
  | { status: 'pending'; provider: OAuthProvider; url: string; state: string }
  | { status: 'unconfigured' | 'rejected' | 'unavailable' };
export type OAuthProgress = {
  status:
    | 'pending'
    | 'succeeded'
    | 'failed'
    | 'expired'
    | 'unconfigured'
    | 'rejected'
    | 'unavailable';
};
export type OAuthCancellation = {
  status: 'cancelled' | 'expired' | 'unconfigured' | 'rejected' | 'unavailable';
};

export async function readPool(): Promise<Loaded<PoolReading>> {
  const { data, error } = await kira.api.admin.pool.get();
  if (error)
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not read Pool health.',
      ),
    };
  return { ok: true, value: data };
}

export async function readPoolAudit(): Promise<Loaded<PoolAuditEvent[]>> {
  const { data, error } = await kira.api.admin.pool.audit.get();
  if (error)
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not read the Pool audit trail.',
      ),
    };
  return { ok: true, value: data.events };
}

export async function startPoolLogin(provider: OAuthProvider): Promise<Loaded<OAuthState>> {
  const { data, error } = await kira.api.admin.pool.oauth.post({ provider });
  if (error)
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not start provider sign-in.',
      ),
    };
  return { ok: true, value: data as OAuthState };
}

export async function relayPoolCallback(
  provider: OAuthProvider,
  redirectUrl: string,
): Promise<Loaded<{ status: 'accepted' | 'unconfigured' | 'rejected' | 'unavailable' }>> {
  const { data, error } = await kira.api.admin.pool.oauth.callback.post({ provider, redirectUrl });
  if (error)
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not relay the provider callback.',
      ),
    };
  return {
    ok: true,
    value: data as { status: 'accepted' | 'unconfigured' | 'rejected' | 'unavailable' },
  };
}

export async function readPoolLogin(state: string): Promise<Loaded<OAuthProgress>> {
  const { data, error } = await kira.api.admin.pool.oauth.status.get({ query: { state } });
  if (error)
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not check provider sign-in.',
      ),
    };
  return { ok: true, value: data as OAuthProgress };
}

export async function cancelPoolLogin(state: string): Promise<Loaded<OAuthCancellation>> {
  const { data, error } = await kira.api.admin.pool.oauth.delete(undefined, { query: { state } });
  if (error)
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not cancel provider sign-in.',
      ),
    };
  return { ok: true, value: data as OAuthCancellation };
}

export type CredentialActionResult = {
  status: 'succeeded' | 'unconfigured' | 'rejected' | 'unavailable' | 'not-found';
};

export async function setCredentialDisabled(
  id: string,
  disabled: boolean,
): Promise<Loaded<CredentialActionResult>> {
  const { data, error } = await kira.api.admin.pool.credentials({ id }).status.patch({ disabled });
  if (error)
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not update this Credential.',
      ),
    };
  return { ok: true, value: data as CredentialActionResult };
}

export async function refreshCredential(id: string): Promise<Loaded<CredentialActionResult>> {
  const { data, error } = await kira.api.admin.pool.credentials({ id }).refresh.post();
  if (error)
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not refresh this Credential.',
      ),
    };
  return { ok: true, value: data as CredentialActionResult };
}

export async function deleteCredential(id: string): Promise<Loaded<CredentialActionResult>> {
  const { data, error } = await kira.api.admin.pool.credentials({ id }).delete();
  if (error)
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not delete this Credential.',
      ),
    };
  return { ok: true, value: data as CredentialActionResult };
}
