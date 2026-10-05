/**
 * The Changes view's two lists: the files that changed, and the commits behind
 * them.
 *
 * The file list is only an index. A row says which file, where it is, how much
 * changed and whether it is staged, and opens the review where the diff is read;
 * the circle at its start is the one thing on the row that acts, because staging
 * a whole file should not need the diff open.
 */
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  focusVars,
  radiusVars,
  spacingVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { Circle, CircleCheck, CircleDashed } from 'lucide-react';
import type { ChangedPath, CommitSummary } from '../../preload/bridge';
import { type ChangedFile, ageOf, statusWord } from './changesModel';
import { Counts, Letter, parts } from './changesParts';
import { FileTypeIcon } from './fileTypeIcon';
import { pathParts } from './memoryGroups';

const styles = stylex.create({
  rows: { margin: 0, padding: 0, listStyle: 'none' },
  row: {
    borderBlockEndWidth: { default: borderVars['--border-width'], ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    boxSizing: 'border-box',
    width: 'calc(100% + 16px)',
    minHeight: 48,
    marginInline: -8,
    paddingInlineStart: 2,
    paddingInlineEnd: spacingVars['--spacing-2'],
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
  },
  open: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: '-2px',
  },
  stack: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
  tail: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 },
  commit: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-0-5'],
    width: '100%',
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
  },
  commitFiles: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlockEnd: spacingVars['--spacing-2'],
  },
});

const GLYPH = {
  staged: { icon: CircleCheck, label: 'Unstage file', color: 'accent' },
  partial: { icon: CircleDashed, label: 'Stage the rest of this file', color: 'secondary' },
  unstaged: { icon: Circle, label: 'Stage file', color: 'secondary' },
} as const;

export function ChangesList({
  files,
  isBusy,
  onOpen,
  onToggle,
}: {
  files: readonly ChangedFile[];
  isBusy: boolean;
  onOpen: (path: string) => void;
  /** Stage a file that is not fully staged; unstage one that is. */
  onToggle: (file: ChangedFile) => void;
}) {
  return (
    <ul {...stylex.props(styles.rows)}>
      {files.map((file) => {
        const { name, folder } = pathParts(file.path);
        const glyph = GLYPH[file.state];

        return (
          <li key={file.path} {...stylex.props(styles.row)}>
            <div {...stylex.props(styles.item)}>
              <IconButton
                label={glyph.label}
                variant="ghost"
                size="sm"
                isDisabled={isBusy}
                icon={<Icon icon={glyph.icon} size="sm" color={glyph.color} />}
                onClick={() => onToggle(file)}
              />
              <button
                type="button"
                title={`${file.path} · ${statusWord(file.status)}`}
                {...stylex.props(styles.open)}
                onClick={() => onOpen(file.path)}
              >
                <FileTypeIcon name={name} kind="file" />
                <span {...stylex.props(styles.stack)}>
                  <Text type="label" maxLines={1}>
                    {name}
                  </Text>
                  <Text type="supporting" color="secondary" maxLines={1}>
                    {folder === '' ? 'repository root' : folder}
                  </Text>
                </span>
                <span {...stylex.props(styles.tail)}>
                  <Counts added={file.added} removed={file.removed} />
                  <Letter status={file.status} />
                </span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function HistoryList({
  history,
  trouble,
  openCommit,
  openFiles,
  onToggle,
}: {
  history: readonly CommitSummary[] | null;
  trouble: string | null;
  openCommit: string | null;
  /** The files of the open commit, or null while they are being read. */
  openFiles: readonly ChangedPath[] | null;
  onToggle: (hash: string) => void;
}) {
  // Read once when the list is shown, so an age does not shift while it is being read.
  const [now] = useState(Date.now);

  if (trouble !== null) {
    return (
      <Text type="supporting" color="secondary">
        {trouble}
      </Text>
    );
  }
  if (history === null) return null;
  if (history.length === 0) {
    return (
      <Text type="supporting" color="secondary">
        This branch has no commits yet.
      </Text>
    );
  }

  return (
    <ul {...stylex.props(styles.rows)}>
      {history.map((commit) => (
        <li key={commit.hash} {...stylex.props(styles.row)}>
          <button
            type="button"
            aria-expanded={openCommit === commit.hash}
            {...stylex.props(styles.commit)}
            onClick={() => onToggle(commit.hash)}
          >
            <Text type="label">{commit.subject}</Text>
            <span {...stylex.props(parts.mono)}>
              {commit.short} · {commit.author} · {ageOf(commit.date, now)}
            </span>
          </button>
          {openCommit === commit.hash && (
            <div {...stylex.props(styles.commitFiles)}>
              {openFiles === null ? (
                <Text type="supporting" color="secondary">
                  Reading…
                </Text>
              ) : (
                openFiles.map((file) => (
                  <Text key={file.path} type="supporting" color="secondary">
                    {file.path} · {statusWord(file.status)}
                  </Text>
                ))
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
