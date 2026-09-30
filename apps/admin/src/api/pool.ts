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

export async function readPool(): Promise<Loaded<PoolReading>> {
  const { data, error } = await kira.api.admin.pool.get();
  if (error) return { ok: false, message: reasonFor(error.value as { message?: string } | null, 'Kira could not read Pool health.') };
  return { ok: true, value: data };
}

export async function readPoolAudit(): Promise<Loaded<PoolAuditEvent[]>> {
  const { data, error } = await kira.api.admin.pool.audit.get();
  if (error) return { ok: false, message: reasonFor(error.value as { message?: string } | null, 'Kira could not read the Pool audit trail.') };
  return { ok: true, value: data.events };
}
