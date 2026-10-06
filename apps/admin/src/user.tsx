import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { isAdminRole } from './adminRole';
import { type Reading, readAllowance, setAllowance } from './api/allowances';
import type { Loaded } from './api/result';
import {
  type ConsoleSession,
  type DeviceKey,
  impersonate,
  readKeys,
  readSessions,
  revokeKey,
  revokeSession,
  revokeSessions,
  setRole,
  setSuspended,
} from './api/users';
import { formatWhen, summaryOf } from './allowanceText';
import { useConsoleData } from './consoleData';

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-5'],
    padding: spacingVars['--spacing-8'],
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    maxWidth: '72ch',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    maxWidth: '72ch',
  },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: spacingVars['--spacing-2'] },
  actions: { display: 'flex', flexWrap: 'wrap', gap: spacingVars['--spacing-2'] },
  reasonForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    maxWidth: '48ch',
  },
  input: {
    minHeight: 44,
    padding: spacingVars['--spacing-3'],
    border: '1px solid var(--astryx-color-border-default)',
    borderRadius: 'var(--astryx-radius-sm)',
    font: 'inherit',
  },
  list: {
    display: 'grid',
    gap: spacingVars['--spacing-2'],
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  item: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    padding: spacingVars['--spacing-3'],
    border: '1px solid var(--astryx-color-border-default)',
    borderRadius: 'var(--astryx-radius-md)',
  },
  keyDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    minWidth: 0,
  },
});

function describeSession(session: ConsoleSession): string {
  const where = session.userAgent ?? session.ipAddress ?? 'An unknown device';
  return `${where} · signed in ${new Date(session.createdAt).toLocaleString()}`;
}

function describeKey(key: DeviceKey): string {
  const created = `created ${new Date(key.createdAt).toLocaleDateString()}`;
  const used =
    key.lastUsedAt === null
      ? 'never used'
      : `last used ${new Date(key.lastUsedAt).toLocaleDateString()}`;
  const expires =
    key.expiresAt === null
      ? 'no expiry'
      : `expires ${new Date(key.expiresAt).toLocaleDateString()}`;
  return `${created} · ${used} · ${expires}`;
}

/**
 * One person, and what may be done to their access.
 *
 * Three levers: the role, which decides whether the console opens for them;
 * suspension, which cuts off the desktop at once (docs/adr/0035); and their
 * console sessions, which can be ended one at a time or all together. A refusal
 * from any is the server's sentence rather than a button that quietly did nothing.
 */
export default function User({ userId }: { userId: string }) {
  const { users, updateUser } = useConsoleData();
  const person = users.find((each) => each.id === userId);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askingReason, setAskingReason] = useState(false);
  const [reason, setReason] = useState('');
  const [sessions, setSessions] = useState<ConsoleSession[] | null>(null);
  const [sessionProblem, setSessionProblem] = useState<string | null>(null);
  const [keys, setKeys] = useState<DeviceKey[] | null>(null);
  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  const [reading, setReading] = useState<Loaded<Reading> | null>(null);
  const [tokens, setTokens] = useState<number | null>(null);
  const [allowanceProblem, setAllowanceProblem] = useState<string | null>(null);

  async function refreshAllowance() {
    const result = await readAllowance(userId);
    setReading(result);
    if (result.ok) setTokens(result.value.override ?? result.value.allowance);
  }

  async function saveAllowance(wanted: number | null) {
    setBusy(true);
    setAllowanceProblem(null);
    const result = await setAllowance(userId, wanted);
    setBusy(false);

    if (!result.ok) {
      setAllowanceProblem(result.message);
      return;
    }

    setReading({ ok: true, value: result.value });
    setTokens(result.value.override ?? result.value.allowance);
  }

  async function refreshSessions() {
    const result = await readSessions(userId);
    if (result.ok) {
      setSessions(result.value);
      setSessionProblem(null);
    } else {
      setSessionProblem(result.message);
    }
  }

  async function refreshKeys() {
    const result = await readKeys(userId);
    if (result.ok) {
      setKeys(result.value);
      setKeyProblem(null);
    } else {
      setKeyProblem(result.message);
    }
  }

  useEffect(() => {
    void refreshSessions();
    void refreshKeys();
    void refreshAllowance();
    // Read once per person: what changes them is a revocation, which reloads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!person) {
    return (
      <main {...stylex.props(styles.page)}>
        <header {...stylex.props(styles.header)}>
          <Heading level={1}>Not found</Heading>
          <Text color="secondary">Nobody with that id has signed in to Kira.</Text>
        </header>
      </main>
    );
  }

  const isAdmin = isAdminRole(person.role);

  async function change(to: 'admin' | 'user') {
    setBusy(true);
    setProblem(null);
    const result = await setRole(userId, to);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.message);
      return;
    }

    updateUser({ id: userId, role: result.value.role });
  }

  async function suspend(suspended: boolean, why?: string) {
    setBusy(true);
    setProblem(null);
    const result = await setSuspended(userId, suspended, why);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.message);
      return;
    }

    setAskingReason(false);
    setReason('');
    updateUser({ id: userId, banned: result.value.suspended });
  }

  async function signOutSession(sessionId: string) {
    setBusy(true);
    const result = await revokeSession(userId, sessionId);
    setBusy(false);

    if (!result.ok) {
      setSessionProblem(result.message);
      return;
    }

    await refreshSessions();
  }

  async function signOutEverywhere() {
    setBusy(true);
    const result = await revokeSessions(userId);
    setBusy(false);

    if (!result.ok) {
      setSessionProblem(result.message);
      return;
    }

    await refreshSessions();
  }

  async function revokeOneKey(keyId: string) {
    setBusy(true);
    const result = await revokeKey(userId, keyId);
    setBusy(false);

    if (!result.ok) {
      setKeyProblem(result.message);
      return;
    }

    await refreshKeys();
  }

  async function act() {
    setBusy(true);
    setProblem(null);
    const result = await impersonate(userId);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.message);
      return;
    }

    // The browser now holds the other person's session, so the page re-reads Kira.
    window.location.reload();
  }

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <Heading level={1}>{person.name}</Heading>
        <Text color="secondary">{person.email}</Text>
      </header>
      <section aria-labelledby="user-role-heading" {...stylex.props(styles.section)}>
        <Heading level={2} id="user-role-heading">
          Role
        </Heading>
        <div {...stylex.props(styles.row)}>
          <Badge label={person.role} variant={isAdmin ? 'info' : 'neutral'} />
          <Text color="secondary">
            {isAdmin ? 'May run Kira from the console.' : 'May use Kira; not an administrator.'}
          </Text>
        </div>
        <div {...stylex.props(styles.actions)}>
          {isAdmin ? (
            <Button
              label="Remove admin"
              variant="secondary"
              isDisabled={busy}
              onClick={() => void change('user')}
            />
          ) : (
            <Button label="Make admin" isDisabled={busy} onClick={() => void change('admin')} />
          )}
        </div>
      </section>
      <section aria-labelledby="user-access-heading" {...stylex.props(styles.section)}>
        <Heading level={2} id="user-access-heading">
          Access
        </Heading>
        <div {...stylex.props(styles.row)}>
          <Badge
            label={person.banned ? 'Suspended' : 'Active'}
            variant={person.banned ? 'warning' : 'success'}
          />
          <Text color="secondary">
            {person.banned
              ? 'Their Key is refused and they cannot sign in.'
              : 'Their Key works and they can sign in.'}
          </Text>
        </div>
        {person.banned ? (
          <div {...stylex.props(styles.actions)}>
            <Button label="Reactivate" isDisabled={busy} onClick={() => void suspend(false)} />
          </div>
        ) : askingReason ? (
          <div {...stylex.props(styles.reasonForm)}>
            <label htmlFor="suspend-reason">Why (optional)</label>
            <input
              id="suspend-reason"
              type="text"
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              {...stylex.props(styles.input)}
            />
            <div {...stylex.props(styles.actions)}>
              <Button
                label="Suspend"
                variant="secondary"
                isDisabled={busy}
                onClick={() => void suspend(true, reason)}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onClick={() => {
                  setAskingReason(false);
                  setReason('');
                }}
              />
            </div>
          </div>
        ) : (
          <div {...stylex.props(styles.actions)}>
            <Button label="Suspend" variant="secondary" onClick={() => setAskingReason(true)} />
          </div>
        )}
      </section>
      <section aria-labelledby="user-allowance-heading" {...stylex.props(styles.section)}>
        <Heading level={2} id="user-allowance-heading">
          Allowance
        </Heading>
        {reading === null ? (
          <Text color="secondary">Loading…</Text>
        ) : !reading.ok ? (
          <Text color="secondary">{reading.message}</Text>
        ) : (
          <>
            <div {...stylex.props(styles.row)}>
              <Text>{summaryOf(reading.value).text}</Text>
              <Text color="secondary">
                {reading.value.override === null
                  ? 'the default everyone gets'
                  : 'their own number, replacing the default'}
              </Text>
            </div>
            {reading.value.refusals.length > 0 && (
              <div {...stylex.props(styles.reasonForm)}>
                <Text weight="semibold">Turned away this month</Text>
                {reading.value.refusals.map((refusal, index) => (
                  <Text key={`${refusal.at}-${String(index)}`} color="secondary" size="sm">
                    {`${formatWhen(refusal.at)} — ${refusal.model} — ${refusal.reason}`}
                  </Text>
                ))}
              </div>
            )}
            <NumberInput
              label="Tokens per month"
              value={tokens}
              onChange={setTokens}
              isDisabled={busy}
              status={
                allowanceProblem === null ? undefined : { type: 'error', message: allowanceProblem }
              }
            />
            <div {...stylex.props(styles.actions)}>
              <Button
                label="Save"
                isDisabled={busy}
                onClick={() => {
                  if (tokens === null || !Number.isInteger(tokens) || tokens <= 0) {
                    setAllowanceProblem('An allowance is a positive whole number of tokens.');
                    return;
                  }

                  void saveAllowance(tokens);
                }}
              />
              {reading.value.override === null ? null : (
                <Button
                  label="Back to the default"
                  variant="secondary"
                  isDisabled={busy}
                  onClick={() => void saveAllowance(null)}
                />
              )}
            </div>
          </>
        )}
      </section>
      <section aria-labelledby="user-sessions-heading" {...stylex.props(styles.section)}>
        <Heading level={2} id="user-sessions-heading">
          Sessions
        </Heading>
        <Text color="secondary">Where this person is signed into the console.</Text>
        {sessionProblem && <Text role="alert">{sessionProblem}</Text>}
        {sessions !== null && sessions.length === 0 && (
          <Text color="secondary">No console sessions are open.</Text>
        )}
        {sessions !== null && sessions.length > 0 && (
          <>
            <ul {...stylex.props(styles.list)}>
              {sessions.map((session) => (
                <li {...stylex.props(styles.item)} key={session.id}>
                  <Text color="secondary">{describeSession(session)}</Text>
                  <Button
                    label="Sign out"
                    variant="secondary"
                    isDisabled={busy}
                    onClick={() => void signOutSession(session.id)}
                  />
                </li>
              ))}
            </ul>
            <div {...stylex.props(styles.actions)}>
              <Button
                label="Sign out everywhere"
                variant="secondary"
                isDisabled={busy}
                onClick={() => void signOutEverywhere()}
              />
            </div>
          </>
        )}
      </section>
      <section aria-labelledby="user-keys-heading" {...stylex.props(styles.section)}>
        <Heading level={2} id="user-keys-heading">
          Keys
        </Heading>
        <Text color="secondary">The devices holding a Kira Key for this person.</Text>
        {keyProblem && <Text role="alert">{keyProblem}</Text>}
        {keys !== null && keys.length === 0 && (
          <Text color="secondary">No device holds a Key for this person.</Text>
        )}
        {keys !== null && keys.length > 0 && (
          <ul {...stylex.props(styles.list)}>
            {keys.map((key) => (
              <li {...stylex.props(styles.item)} key={key.id}>
                <div {...stylex.props(styles.keyDetails)}>
                  <Text weight="semibold">{key.name ?? 'Unnamed device'}</Text>
                  <Text color="secondary" size="sm">
                    {describeKey(key)}
                  </Text>
                </div>
                <Button
                  label="Revoke"
                  variant="secondary"
                  isDisabled={busy}
                  onClick={() => void revokeOneKey(key.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="user-impersonate-heading" {...stylex.props(styles.section)}>
        <Heading level={2} id="user-impersonate-heading">
          Act as this person
        </Heading>
        <Text color="secondary">
          See Kira as they see it. A marker stays on screen while you do, and one click returns you
          to yourself.
        </Text>
        <div {...stylex.props(styles.actions)}>
          <Button
            label="Impersonate"
            variant="secondary"
            isDisabled={busy}
            onClick={() => void act()}
          />
        </div>
      </section>
      {problem && <Text role="alert">{problem}</Text>}
    </main>
  );
}
