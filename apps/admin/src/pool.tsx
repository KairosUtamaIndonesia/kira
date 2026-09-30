import { Badge } from '@astryxdesign/core/Badge';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { type PoolAuditEvent, type PoolCredential, type PoolReading, readPool, readPoolAudit } from './api/pool';
import type { Readings } from './api/allowances';
import type { ListedUser } from './api/users';

const REFRESH_MS = 30_000;

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-5'], padding: spacingVars['--spacing-8'] },
  header: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'], maxWidth: '72ch' },
  list: { display: 'grid', gap: spacingVars['--spacing-3'], listStyle: 'none', margin: 0, padding: 0 },
  item: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'], padding: spacingVars['--spacing-4'], border: '1px solid var(--astryx-color-border-default)', borderRadius: 'var(--astryx-radius-md)' },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: spacingVars['--spacing-2'] },
});

export default function Pool({ users, readings }: { users: ListedUser[]; readings: Readings }) {
  const [reading, setReading] = useState<PoolReading | null>(null);
  const [audit, setAudit] = useState<PoolAuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [pool, events] = await Promise.all([readPool(), readPoolAudit()]);
      if (!active) return;
      if (pool.ok) {
        setReading(pool.value);
        setError(null);
        setUpdatedAt(new Date());
      } else {
        setError(pool.message);
      }
      if (events.ok) setAudit(events.value);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <Heading level={1}>Pool</Heading>
        <Text color="secondary">
          Shared provider Credentials and their current health. Provider rate-limit signals are not a measure of total Pool capacity.
        </Text>
        {updatedAt && <Text color="secondary" size="sm">Updated {updatedAt.toLocaleTimeString()}</Text>}
      </header>
      {error && <Text role="alert">{error}</Text>}
      {reading?.status === 'unconfigured' && (
        <Text role="status">Pool management is not configured. Other admin features remain available.</Text>
      )}
      {reading?.status === 'rejected' && (
        <Text role="alert">The CLIProxyAPI management key was rejected. Kira has stopped management requests to avoid locking out this server.</Text>
      )}
      {reading?.status === 'unavailable' && <Text role="alert">CLIProxyAPI management is temporarily unavailable.</Text>}
      {reading?.status === 'ready' && (
        reading.credentials.length === 0
          ? <Text>No provider Credentials are configured in the Pool.</Text>
          : <ul {...stylex.props(styles.list)}>{reading.credentials.map((credential) => <Credential key={credential.id} credential={credential} />)}</ul>
      )}
      <section aria-labelledby="pool-usage-heading">
        <Heading level={2} id="pool-usage-heading">People's Usage and Allowances</Heading>
        {users.length === 0 ? <Text color="secondary">Nobody has signed in yet.</Text> : (
          <ul {...stylex.props(styles.list)}>{users.map((user) => {
            const result = readings[user.id];
            return <li {...stylex.props(styles.item)} key={user.id}>
              <Text weight="semibold">{user.name}</Text>
              <Text color="secondary">{user.email}</Text>
              {!result ? <Text color="secondary">Usage has not loaded.</Text> : result.ok ? (
                <Text>{result.value.used.toLocaleString()} / {result.value.allowance.toLocaleString()} tokens this month</Text>
              ) : <Text color="secondary">{result.message}</Text>}
            </li>;
          })}</ul>
        )}
      </section>
      <section aria-labelledby="pool-audit-heading">
        <Heading level={2} id="pool-audit-heading">Recent Pool changes</Heading>
        {audit.length === 0 ? <Text color="secondary">No Pool management attempts have been recorded.</Text> : (
          <ul {...stylex.props(styles.list)}>{audit.map((event) => <AuditRow key={event.id} event={event} />)}</ul>
        )}
      </section>
    </main>
  );
}

function Credential({ credential }: { credential: PoolCredential }) {
  const name = credential.email ?? credential.label ?? credential.name ?? credential.id;
  const condition = credential.disabled ? 'Disabled' : credential.unavailable ? 'Unavailable' : credential.status ?? 'Unknown';
  return (
    <li {...stylex.props(styles.item)}>
      <div {...stylex.props(styles.row)}>
        <Text weight="semibold">{name}</Text>
        {credential.provider && <Badge label={credential.provider} variant="blue" />}
        {condition === 'active' ? <Text color="secondary">Active</Text> : (
          <Badge label={condition} variant={credential.unavailable ? 'error' : 'warning'} />
        )}
      </div>
      {credential.nextRetryAfter && <Text color="secondary">Retry after {credential.nextRetryAfter}</Text>}
      {credential.cooldowns.map((cooldown, index) => (
        <Text color="secondary" key={`${cooldown.scope ?? 'credential'}-${cooldown.model_key ?? ''}-${index}`}>
          Cooldown{cooldown.model_key ? ` for ${cooldown.model_key}` : ''}: {cooldown.reason ?? 'provider cooldown'}
          {cooldown.remaining_seconds === undefined ? '' : ` · ${cooldown.remaining_seconds}s remaining`}
        </Text>
      ))}
      {credential.quota && Object.keys(credential.quota).length > 0 && (
        <Text color="secondary">Rate-limit signals: {Object.entries(credential.quota).map(([key, value]) => `${key}: ${value}`).join(', ')}</Text>
      )}
    </li>
  );
}

function AuditRow({ event }: { event: PoolAuditEvent }) {
  return (
    <li {...stylex.props(styles.item)}>
      <div {...stylex.props(styles.row)}>
        <Text weight="semibold">{event.action}</Text>
        <Badge label={event.outcome} variant={event.outcome === 'succeeded' ? 'success' : 'warning'} />
        {event.provider && <Text>{event.provider}</Text>}
        {event.credentialLabel && <Text>{event.credentialLabel}</Text>}
      </div>
      <Text color="secondary">{event.actorLabel} · {new Date(event.createdAt).toLocaleString()}</Text>
      {event.detail && <Text color="secondary">{event.detail}</Text>}
    </li>
  );
}
