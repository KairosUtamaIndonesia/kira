/**
 * The pull requests reviewing a ticket, with the state their host reported.
 *
 * A row appears here once the host's webhook names the ticket, and a merge is
 * what moves a ticket in Needs review to Done, so this is where a person sees
 * the review that closed it (docs/adr/0026). When no pull request is linked the
 * section stays away rather than saying nothing happened.
 */
import { Text } from '@astryxdesign/core/Text';
import { colorVars, spacingVars, textSizeVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import type { TicketPullRequest } from '../../preload/bridge.ts';
import { copy } from './workCopy.ts';

function useOnce(effect: () => void): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

function openLink(href: string): false {
  window.open(href, '_blank', 'noopener');

  return false;
}

export function PullRequests({ ticketId }: { ticketId: string }) {
  const [pullRequests, setPullRequests] = useState<TicketPullRequest[] | null>(null);

  useOnce(() => {
    void (async () => {
      const answer = await window.kira.loadPullRequests(ticketId);
      setPullRequests(answer.ok ? answer.value : []);
    })();
  });

  if (pullRequests === null || pullRequests.length === 0) return null;

  return (
    <section {...stylex.props(ui.section)} aria-label={copy.ticket.pullRequests}>
      <Text type="label" weight="medium">
        {copy.ticket.pullRequests}
      </Text>
      <ul {...stylex.props(ui.list)}>
        {pullRequests.map((request) => (
          <li key={request.id} {...stylex.props(ui.row)}>
            <a
              href={request.url}
              {...stylex.props(ui.link)}
              onClick={(event) => {
                event.preventDefault();
                openLink(request.url);
              }}
            >
              {`#${request.number} ${request.title}`}
            </a>
            <Text type="supporting" color="secondary">
              {request.authorLogin === null
                ? request.state
                : `${request.state} · ${copy.ticket.pullRequestBy(request.authorLogin)}`}
            </Text>
          </li>
        ))}
      </ul>
    </section>
  );
}

const ui = stylex.create({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-3'],
  },
  link: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: colorVars['--color-text-accent'],
    fontSize: textSizeVars['--font-size-base'],
  },
});
