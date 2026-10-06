import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { setRole } from './api/users';
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
});

/** The role that runs Kira, as the server's own plugin spells it. */
const ADMIN_ROLE = 'admin';

/**
 * One person, and what may be done to their access.
 *
 * The role is the first lever: it decides whether the rest of the console opens
 * for them. The last-administrator guard is the server's, so a refusal is a
 * sentence from Kira rather than a button that quietly did nothing.
 */
export default function User({ userId }: { userId: string }) {
  const { users, updateUser } = useConsoleData();
  const person = users.find((each) => each.id === userId);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        {problem && <Text role="alert">{problem}</Text>}
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
    </main>
  );
}
