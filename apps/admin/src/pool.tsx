import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import {
  cancelPoolLogin,
  type OAuthProvider,
  type PoolAuditEvent,
  type PoolCredential,
  type PoolReading,
  readPool,
  readPoolAudit,
  readPoolLogin,
  relayPoolCallback,
  startPoolLogin,
} from './api/pool';
import type { Readings } from './api/allowances';
import type { ListedUser } from './api/users';

const REFRESH_MS = 30_000;

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-5'], padding: spacingVars['--spacing-8'] },
  header: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'], maxWidth: '72ch' },
  list: { display: 'grid', gap: spacingVars['--spacing-3'], listStyle: 'none', margin: 0, padding: 0 },
  item: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'], padding: spacingVars['--spacing-4'], border: '1px solid var(--astryx-color-border-default)', borderRadius: 'var(--astryx-radius-md)' },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: spacingVars['--spacing-2'] },
  login: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'], maxWidth: '64ch' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: spacingVars['--spacing-2'] },
  input: { width: '100%', minHeight: 44, padding: spacingVars['--spacing-3'], border: '1px solid var(--astryx-color-border-default)', borderRadius: 'var(--astryx-radius-sm)', font: 'inherit' },
});

export default function Pool({ users, readings }: { users: ListedUser[]; readings: Readings }) {
  const [reading, setReading] = useState<PoolReading | null>(null);
  const [audit, setAudit] = useState<PoolAuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [login, setLogin] = useState<{ provider: OAuthProvider; state: string; url: string; startedAt: number } | null>(null);
  const [callback, setCallback] = useState('');
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);

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

  useEffect(() => {
    if (!login) return;
    let active = true;
    const poll = async () => {
      const progress = await readPoolLogin(login.state);
      if (!active || !progress.ok) return;
      switch (progress.value.status) {
        case 'pending':
          return;
        case 'succeeded':
          setLogin(null);
          setCallback('');
          setLoginMessage('Provider sign-in completed. Refreshing the Pool.');
          void Promise.all([readPool(), readPoolAudit()]).then(([pool, events]) => {
            if (pool.ok) setReading(pool.value);
            if (events.ok) setAudit(events.value);
          });
          return;
        case 'expired':
          setLogin(null);
          setLoginMessage('This provider login expired. Start a new login to try again.');
          return;
        case 'failed':
          setLogin(null);
          setLoginMessage('The provider could not complete sign-in. Start a new login to try again.');
          return;
        case 'rejected':
          setLogin(null);
          setLoginMessage('The CLIProxyAPI management key was rejected. Kira has stopped management requests.');
          return;
        case 'unconfigured':
          setLogin(null);
          setLoginMessage('Pool management is not configured.');
          return;
        case 'unavailable':
          setLoginMessage('The proxy could not be reached. The login may still be pending; try checking again.');
          return;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [login]);

  const beginLogin = async (provider: OAuthProvider) => {
    setLoginBusy(true);
    setLoginMessage(null);
    try {
      const started = await startPoolLogin(provider);
      if (!started.ok) {
        setLoginMessage(started.message);
      } else if (started.value.status === 'pending') {
        setLogin({ ...started.value, startedAt: Date.now() });
      } else {
        setLoginMessage(managementMessage(started.value.status));
      }
    } catch {
      setLoginMessage('Kira could not start provider sign-in.');
    } finally {
      setLoginBusy(false);
    }
  };

  const submitCallback = async () => {
    if (!login || callback.trim() === '') return;
    const pastedUrl = callback.trim();
    setCallback('');
    setLoginBusy(true);
    setLoginMessage(null);
    try {
      const result = await relayPoolCallback(login.provider, pastedUrl);
      if (!result.ok) setLoginMessage(result.message);
      else if (result.value.status === 'accepted') setLoginMessage('Callback received. Waiting for the provider to finish sign-in.');
      else setLoginMessage(managementMessage(result.value.status));
    } catch {
      setLoginMessage('Kira could not relay the provider callback.');
    } finally {
      setLoginBusy(false);
    }
  };

  const cancelLogin = async () => {
    if (!login) return;
    setLoginBusy(true);
    try {
      const result = await cancelPoolLogin(login.state);
      if (!result.ok) setLoginMessage(result.message);
      else if (result.value.status === 'cancelled' || result.value.status === 'expired') {
        setLogin(null);
        setCallback('');
        setLoginMessage(result.value.status === 'cancelled' ? 'Provider login cancelled.' : 'Provider login already expired.');
      } else setLoginMessage(managementMessage(result.value.status));
    } catch {
      setLoginMessage('Kira could not cancel provider sign-in.');
    } finally {
      setLoginBusy(false);
    }
  };

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
      <section aria-labelledby="pool-add-credential-heading" {...stylex.props(styles.login)}>
        <Heading level={2} id="pool-add-credential-heading">Add a provider login</Heading>
        {!login && <div {...stylex.props(styles.actions)}>
          <Button label="Add Codex login" onClick={() => void beginLogin('codex')} isDisabled={loginBusy || reading?.status !== 'ready'} />
          <Button label="Add Claude login" onClick={() => void beginLogin('claude')} isDisabled={loginBusy || reading?.status !== 'ready'} />
        </div>}
        {login && <>
          <Text>Sign in at the provider, then paste the localhost callback address here. The proxy expires this login after about five minutes.</Text>
          <a href={login.url} target="_blank" rel="noreferrer">Open {login.provider === 'codex' ? 'Codex' : 'Claude'} sign-in</a>
          <label htmlFor="pool-oauth-callback">Provider callback URL</label>
          <input
            id="pool-oauth-callback"
            type="url"
            autoComplete="off"
            value={callback}
            onChange={(event) => setCallback(event.currentTarget.value)}
            placeholder="http://localhost:…/callback?code=…&state=…"
            {...stylex.props(styles.input)}
          />
          <div {...stylex.props(styles.actions)}>
            <Button label="Submit callback" onClick={() => void submitCallback()} isDisabled={loginBusy || callback.trim() === ''} />
            <Button label="Cancel login" variant="secondary" onClick={() => void cancelLogin()} isDisabled={loginBusy} />
          </div>
          <Text color="secondary">Waiting for provider confirmation…</Text>
        </>}
        {loginMessage && <Text role="status">{loginMessage}</Text>}
      </section>
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

function managementMessage(status: 'unconfigured' | 'rejected' | 'unavailable'): string {
  if (status === 'unconfigured') return 'Pool management is not configured.';
  if (status === 'rejected') return 'The CLIProxyAPI management key was rejected. Kira has stopped management requests.';
  return 'CLIProxyAPI management is temporarily unavailable.';
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
