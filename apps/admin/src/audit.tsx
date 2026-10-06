import { Badge } from '@astryxdesign/core/Badge';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { type AuditEvent, readAudit } from './api/audit';

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
  list: {
    display: 'grid',
    gap: spacingVars['--spacing-3'],
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    padding: spacingVars['--spacing-4'],
    border: '1px solid var(--astryx-color-border-default)',
    borderRadius: 'var(--astryx-radius-md)',
  },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: spacingVars['--spacing-2'] },
});

/**
 * What administrators have done, and what changed in the Pool, newest first.
 *
 * Read when the page is opened rather than carried in `Opening`, because it is a
 * screen of its own: nothing on it decides what the rest of the console draws.
 */
export default function Audit() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readAudit().then((result) => {
      if (!active) return;
      if (result.ok) setEvents(result.value);
      else setError(result.message);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <Heading level={1}>Audit</Heading>
        <Text color="secondary">
          What administrators have done to people's access, and recent Pool changes, newest first.
        </Text>
      </header>
      {error && <Text role="alert">{error}</Text>}
      {events === null && error === null && <Text color="secondary">Loading…</Text>}
      {events !== null && events.length === 0 && (
        <Text color="secondary">Nothing has been recorded yet.</Text>
      )}
      {events !== null && events.length > 0 && (
        <ul {...stylex.props(styles.list)}>
          {events.map((event) => (
            <li {...stylex.props(styles.item)} key={event.id}>
              <div {...stylex.props(styles.row)}>
                <Text weight="semibold">{event.action}</Text>
                <Badge
                  label={event.outcome}
                  variant={event.outcome === 'succeeded' ? 'success' : 'warning'}
                />
                {event.target && <Text>{event.target}</Text>}
              </div>
              <Text color="secondary">
                {event.actor} · {new Date(event.at).toLocaleString()}
              </Text>
              {event.detail && <Text color="secondary">{event.detail}</Text>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
