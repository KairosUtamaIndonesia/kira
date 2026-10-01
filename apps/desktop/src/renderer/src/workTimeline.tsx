/**
 * A ticket's conversation and its history, oldest first.
 *
 * The conversation is what people and Kira said; the history is what the server
 * recorded happening. They are one list because a reader asking "what happened
 * here" does not care which of the two answered, and the server merges them so
 * this side only has to draw them.
 *
 * The composer posts to the ticket on screen and reads the timeline back, so a
 * comment appears once the server has it rather than being invented here.
 */
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import {
  colorVars,
  radiusVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleCheck, GitPullRequest, MessageSquare, Pencil } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Ticket, TimelineEntry } from '../../preload/bridge.ts';
import { copy } from './workCopy.ts';
import { when } from './workRows.ts';

interface Props {
  ticket: Ticket;
}

const MAX_COMMENT = 8000;

/** One line saying what an activity entry was, from the action and its details. */
function describe(entry: Extract<TimelineEntry, { type: 'activity' }>): string {
  const details = entry.details as {
    from?: unknown;
    to?: unknown;
    blocker?: { name?: unknown };
  };
  const from = typeof details.from === 'string' ? details.from : '';
  const to = typeof details.to === 'string' ? details.to : '';

  switch (entry.action) {
    case 'created':
      return copy.activity.created;
    case 'status_changed':
      return copy.activity.status_changed(statusWord(from), statusWord(to));
    case 'priority_changed':
      return copy.activity.priority_changed(from, to);
    case 'assignee_changed': {
      const person = details.to;
      const name =
        person !== null &&
        typeof person === 'object' &&
        typeof (person as { name?: unknown }).name === 'string'
          ? (person as { name: string }).name
          : null;
      return copy.activity.assignee_changed(name);
    }
    case 'title_changed':
      return copy.activity.title_changed;
    case 'body_updated':
      return copy.activity.body_updated;
    case 'blocker_added':
      return copy.activity.blocker_added(blockerName(details.blocker));
    case 'blocker_removed':
      return copy.activity.blocker_removed(blockerName(details.blocker));
    case 'pull_request_linked':
      return copy.activity.pull_request_linked;
    case 'pull_request_merged':
      return copy.activity.pull_request_merged;
    case 'outcome_recorded':
      return copy.activity.outcome_recorded;
    default:
      return copy.activity.changed;
  }
}

function blockerName(blocker: { name?: unknown } | undefined): string {
  return typeof blocker?.name === 'string' ? blocker.name : 'a ticket';
}

/** A status word for a value the server stored, falling back to the value itself. */
function statusWord(status: string): string {
  const words = (copy.statusWord as Record<string, string>)[status];

  return words ?? status;
}

function activityIcon(action: string) {
  if (action === 'pull_request_merged' || action === 'pull_request_linked') return GitPullRequest;
  if (action === 'created' || action === 'outcome_recorded') return CircleCheck;
  if (action === 'body_updated' || action === 'title_changed') return Pencil;

  return MessageSquare;
}

function openLink(href: string): false {
  window.open(href, '_blank', 'noopener');

  return false;
}

/**
 * The one sync with something outside React: the timeline is the server's, and
 * reading it is not caused by anything the person did. The same escape hatch
 * `work.tsx` uses, and the component is keyed by the ticket it reads
 * (.agents/skills/no-use-effect/SKILL.md).
 */
function useOnce(effect: () => void): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

export function Timeline({ ticket }: Props) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const answer = await window.kira.loadTimeline(ticket.id);
    if (answer.ok) {
      setEntries(answer.value);
      setTrouble(null);
    } else {
      setTrouble(answer.error);
    }
  }, [ticket.id]);

  useOnce(() => {
    void load();
  });

  async function post(): Promise<void> {
    const body = draft.trim();
    if (body === '' || busy) return;

    setBusy(true);
    const answer = await window.kira.postComment(
      ticket.id,
      body,
      replyTo === null ? undefined : replyTo.id,
    );
    setBusy(false);

    if (!answer.ok) {
      setTrouble(answer.error);

      return;
    }

    setDraft('');
    setReplyTo(null);
    await load();
  }

  return (
    <section {...stylex.props(ui.section)} aria-label={copy.ticket.conversation}>
      <Text type="label" weight="medium">
        {copy.ticket.conversation}
      </Text>

      {trouble !== null && entries === null ? (
        <div {...stylex.props(ui.trouble)}>
          <Text type="supporting" color="secondary">
            {copy.ticket.conversationFailed}
          </Text>
          <Button
            label={copy.ticket.conversationRetry}
            size="sm"
            variant="secondary"
            onClick={() => void load()}
          />
        </div>
      ) : entries === null ? (
        <Text type="supporting" color="secondary">
          {copy.ticket.conversationLoading}
        </Text>
      ) : entries.length === 0 ? (
        <Text type="supporting" color="secondary">
          {copy.ticket.noConversation}
        </Text>
      ) : (
        <ul {...stylex.props(ui.list)}>
          {entries.map((entry) =>
            entry.type === 'comment' ? (
              <Comment
                key={`comment-${entry.id}`}
                entry={entry}
                onReply={() =>
                  setReplyTo({ id: entry.id, name: actorName(entry.authorKind, entry.author) })
                }
              />
            ) : (
              <li key={`activity-${entry.id}`} {...stylex.props(ui.activity)}>
                <Icon
                  icon={activityIcon(entry.action)}
                  size="sm"
                  {...stylex.props(ui.activityIcon)}
                />
                <p {...stylex.props(ui.activityText)}>
                  <Text type="supporting" color="secondary">
                    {`${actorName(entry.actorKind, entry.actor)} ${describe(entry)} · ${when(entry.createdAt)}`}
                  </Text>
                </p>
              </li>
            ),
          )}
        </ul>
      )}

      <div {...stylex.props(ui.composer)}>
        {replyTo !== null && (
          <div {...stylex.props(ui.replyNote)}>
            <Text type="supporting" color="secondary">
              {copy.ticket.replyTo(replyTo.name)}
            </Text>
            <Button
              label={copy.ticket.cancelReply}
              size="sm"
              variant="ghost"
              onClick={() => setReplyTo(null)}
            />
          </div>
        )}
        <TextArea
          label={copy.ticket.commentLabel}
          value={draft}
          onChange={setDraft}
          rows={3}
          maxLength={MAX_COMMENT}
        />
        <div {...stylex.props(ui.composerActions)}>
          <Button
            label={busy ? copy.ticket.commenting : copy.ticket.commentLabel}
            size="sm"
            variant="primary"
            isDisabled={busy || draft.trim() === ''}
            onClick={() => void post()}
          />
        </div>
      </div>
    </section>
  );
}

/** One comment, with the reply action that answers it. */
function Comment({
  entry,
  onReply,
}: {
  entry: Extract<TimelineEntry, { type: 'comment' }>;
  onReply: () => void;
}) {
  const name = actorName(entry.authorKind, entry.author);

  return (
    <li {...stylex.props(ui.comment)}>
      <div {...stylex.props(ui.commentHead)}>
        <Text type="label" weight="medium">
          {name}
        </Text>
        <Text type="supporting" color="secondary">
          {when(entry.createdAt)}
        </Text>
      </div>
      {entry.deleted ? (
        <Text type="supporting" color="secondary" {...stylex.props(ui.removed)}>
          {copy.ticket.commentRemoved}
        </Text>
      ) : (
        <div {...stylex.props(ui.commentBody)}>
          <Markdown density="compact" onLinkClick={openLink}>
            {entry.body}
          </Markdown>
        </div>
      )}
      {!entry.deleted && (
        <div {...stylex.props(ui.commentActions)}>
          <Button
            label={`${copy.ticket.reply} ${name}`}
            size="sm"
            variant="ghost"
            onClick={onReply}
          />
        </div>
      )}
    </li>
  );
}

function actorName(kind: string, author: { id: string; name: string } | null): string {
  if (kind === 'kira') return copy.ticket.kira;
  if (kind === 'system') return copy.ticket.kira;

  return author?.name ?? copy.ticket.someone;
}

const ui = stylex.create({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  activity: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-2'],
  },
  activityIcon: {
    color: colorVars['--color-text-secondary'],
    marginTop: 2,
  },
  activityText: {
    margin: 0,
    minWidth: 0,
  },
  comment: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    paddingBlock: spacingVars['--spacing-3'],
    paddingInline: spacingVars['--spacing-3'],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
  },
  commentHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
  commentBody: {
    fontFamily: typographyVars['--font-family-body'],
    fontSize: textSizeVars['--font-size-base'],
    color: colorVars['--color-text-primary'],
    minWidth: 0,
  },
  commentActions: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  removed: {
    fontStyle: 'italic',
  },
  trouble: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
  },
  composer: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
  },
  replyNote: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
  composerActions: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
});
