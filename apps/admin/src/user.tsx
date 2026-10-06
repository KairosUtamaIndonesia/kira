import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { setRole, setSuspended } from './api/users';
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
});

/** The role that runs Kira, as the server's own plugin spells it. */
const ADMIN_ROLE = 'admin';

/**
 * One person, and what may be done to their access.
 *
 * Two levers: the role, which decides whether the console opens for them, and
 * suspension, which cuts off the desktop at once (docs/adr/0035). A refusal from
 * either is the server's sentence rather than a button that quietly did nothing.
 */
export default function User({ userId }: { userId: string }) {
  const { users, updateUser } = useConsoleData();
  const person = users.find((each) => each.id === userId);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askingReason, setAskingReason] = useState(false);
  const [reason, setReason] = useState('');

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

  const isAdmin = person.role.split(',').includes(ADMIN_ROLE);

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
      {problem && <Text role="alert">{problem}</Text>}
    </main>
  );
}
