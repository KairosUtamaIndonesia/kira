/**
 * The marks the Pull requests view draws for what a host reports: a request's
 * state and what its checks came to. Each is a shape first — the colour only
 * agrees with it — so neither is carried by colour alone.
 */
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { colorVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from 'lucide-react';
import { checksWord, stateWord } from './pullRequestsModel';

const styles = stylex.create({
  merged: { color: colorVars['--color-icon-purple'] },
});

/** The glyph for a request's state. */
export function StateIcon({ state }: { state: string }) {
  switch (state) {
    case 'open':
      return <Icon icon={GitPullRequest} size="sm" color="success" label={stateWord(state)} />;
    case 'draft':
      return (
        <Icon icon={GitPullRequestDraft} size="sm" color="secondary" label={stateWord(state)} />
      );
    case 'merged':
      return <Icon icon={GitMerge} size="sm" xstyle={styles.merged} label={stateWord(state)} />;
    default:
      return <Icon icon={GitPullRequestClosed} size="sm" color="error" label={stateWord(state)} />;
  }
}

/** The state as a badge, for the head of an opened request. */
export function StateBadge({ state }: { state: string }) {
  const variant =
    state === 'open'
      ? 'success'
      : state === 'merged'
        ? 'purple'
        : state === 'closed'
          ? 'error'
          : 'neutral';
  const icon =
    state === 'open'
      ? GitPullRequest
      : state === 'draft'
        ? GitPullRequestDraft
        : state === 'merged'
          ? GitMerge
          : GitPullRequestClosed;

  return <Badge variant={variant} label={stateWord(state)} icon={<Icon icon={icon} size="sm" />} />;
}

/** The glyph for what a set of checks, or one check, came to; nothing when the host reported none. */
export function ChecksIcon({ state }: { state: string | null }) {
  const label = checksWord(state) ?? undefined;

  switch (state) {
    case 'passed':
      return <Icon icon={CircleCheck} size="sm" color="success" label={label} />;
    case 'failed':
      return <Icon icon={CircleX} size="sm" color="error" label={label} />;
    case 'pending':
      return <Icon icon={Clock} size="sm" color="warning" label={label} />;
    case 'neutral':
      return <Icon icon={CircleMinus} size="sm" color="secondary" label={label} />;
    default:
      return null;
  }
}
