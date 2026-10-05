/**
 * PROTOTYPE — variant C, Commit first.
 *
 * The question it asks: people open Changes to make a commit, so should the
 * commit be the page? The message sits at the top with Kira's offer to draft it,
 * one flat list sits under it where a checkbox *is* staging (no Staged/Changes
 * split to learn), the diff peeks in a lower half so list and diff are both on
 * screen, and the branch and push live in a status line at the foot.
 */
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  focusVars,
  radiusVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUp, GitBranch, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { BRANCH, fileState, hunkLabel, hunkPatchOf, statusOf, useFixture } from './fixture';
import { Counts, FileLabel, Letter, Patch } from './parts';

const DRAFT = 'feat(desktop): filter pull requests by state and search them';

const styles = stylex.create({
  tab: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100% + 2 * var(--spacing-4))',
    margin: 'calc(-1 * var(--spacing-4))',
    minHeight: 0,
  },
  compose: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    flexShrink: 0,
    padding: spacingVars['--spacing-4'],
    paddingBlockEnd: spacingVars['--spacing-3'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  message: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: 72,
    resize: 'none',
    padding: spacingVars['--spacing-2'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: {
      default: colorVars['--color-border-emphasized'],
      ':focus': colorVars['--color-accent'],
    },
    borderRadius: radiusVars['--radius-element'],
    color: colorVars['--color-text-primary'],
    backgroundColor: colorVars['--color-background-surface'],
    font: 'inherit',
    outline: 'none',
  },
  composeRow: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'] },
  grow: { flex: 1, minWidth: 0, display: 'flex' },
  between: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  listHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    minHeight: 36,
    paddingInline: spacingVars['--spacing-4'],
  },
  scroll: {
    flex: '1 1 0',
    minHeight: 0,
    overflowY: 'auto',
    paddingInline: spacingVars['--spacing-4'],
  },
  rows: { margin: 0, padding: 0, listStyle: 'none' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minHeight: 32,
    marginInline: -8,
    paddingInline: spacingVars['--spacing-2'],
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
  },
  rowOpen: { backgroundColor: colorVars['--color-background-muted'] },
  pick: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    flex: 1,
    minWidth: 0,
    minHeight: 32,
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
  },
  tail: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'], flexShrink: 0 },
  recentHead: {
    display: 'flex',
    alignItems: 'baseline',
    paddingBlockStart: spacingVars['--spacing-4'],
    paddingBlockEnd: spacingVars['--spacing-1'],
  },
  commit: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr max-content',
    alignItems: 'baseline',
    columnGap: spacingVars['--spacing-3'],
    minHeight: 28,
  },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  peek: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 0',
    minHeight: 0,
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border-emphasized'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  peekHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    flexShrink: 0,
    minHeight: 36,
    paddingInline: spacingVars['--spacing-4'],
  },
  peekBody: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: spacingVars['--spacing-4'],
    paddingBlockStart: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
  },
  hunkBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    minHeight: 28,
  },
  hunkName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  status: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    flexShrink: 0,
    minHeight: 36,
    paddingInline: spacingVars['--spacing-4'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  branch: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'], minWidth: 0 },
});

export function CommitFirst() {
  const fixture = useFixture();
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const files = fixture.files;
  const picked = files.filter((item) => fileState(item) === 'staged').length;
  const selected = files.find((item) => item.path === open);
  const all: boolean | 'indeterminate' =
    fixture.committing === 0 ? false : picked === files.length ? true : 'indeterminate';

  return (
    <div {...stylex.props(styles.tab)}>
      <div {...stylex.props(styles.compose)}>
        <textarea
          {...stylex.props(styles.message)}
          aria-label="Commit message"
          placeholder="Describe what changed"
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
        />
        <div {...stylex.props(styles.composeRow)}>
          <IconButton
            label="Draft a message with Kira"
            icon={<Icon icon={Sparkles} size="sm" />}
            onClick={() => setMessage(DRAFT)}
          />
          <div {...stylex.props(styles.grow)}>
            <Button
              label={
                fixture.committing === 0
                  ? 'Commit'
                  : `Commit ${fixture.committing} ${fixture.committing === 1 ? 'file' : 'files'}`
              }
              size="sm"
              variant="primary"
              width="100%"
              isDisabled={fixture.committing === 0 || message.trim() === ''}
              onClick={() => {
                fixture.commit(message);
                setMessage('');
              }}
            />
          </div>
        </div>
      </div>

      <div {...stylex.props(styles.listHead)}>
        <CheckboxInput
          label={`${fixture.committing} of ${files.length} in this commit`}
          value={all}
          size="sm"
          onChange={(checked) => fixture.setAll(checked)}
        />
        <Text type="supporting" color="secondary">
          {fixture.notice ?? ''}
        </Text>
      </div>

      <div
        {...stylex.props(styles.scroll)}
        style={{
          flexBasis: selected === undefined ? 0 : 'auto',
          flexGrow: selected === undefined ? 1 : 0,
          maxHeight: selected === undefined ? undefined : '40%',
        }}
      >
        <ul {...stylex.props(styles.rows)}>
          {files.map((item) => {
            const state = fileState(item);

            return (
              <li
                key={item.path}
                {...stylex.props(styles.row, open === item.path && styles.rowOpen)}
              >
                <CheckboxInput
                  label={`Include ${item.path}`}
                  isLabelHidden
                  size="sm"
                  value={state === 'staged' ? true : state === 'partial' ? 'indeterminate' : false}
                  onChange={(checked) => fixture.setFile(item.path, checked)}
                />
                <button
                  type="button"
                  title={item.path}
                  {...stylex.props(styles.pick)}
                  onClick={() => setOpen(open === item.path ? null : item.path)}
                >
                  <FileLabel path={item.path} />
                  <span {...stylex.props(styles.tail)} style={{ marginInlineStart: 'auto' }}>
                    <Counts item={item} />
                    <Letter status={statusOf(item)} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {selected === undefined && (
          <>
            <div {...stylex.props(styles.recentHead)}>
              <Text type="label">Recent</Text>
            </div>
            <ul {...stylex.props(styles.rows)}>
              {fixture.history.slice(0, 4).map((commit) => (
                <li key={commit.short} {...stylex.props(styles.commit)}>
                  <span {...stylex.props(styles.mono)}>{commit.short}</span>
                  <Text type="supporting" maxLines={1}>
                    {commit.subject}
                  </Text>
                  <span {...stylex.props(styles.mono)}>{commit.age}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {selected !== undefined && (
        <div {...stylex.props(styles.peek)}>
          <div {...stylex.props(styles.peekHead)}>
            <Text type="supporting" color="secondary" maxLines={1}>
              {selected.path}
            </Text>
            <IconButton
              label="Close diff"
              icon={<Icon icon={X} size="sm" />}
              onClick={() => setOpen(null)}
            />
          </div>
          <div {...stylex.props(styles.peekBody)}>
            {selected.hunks.map((hunk, index) => (
              <div key={hunk.header}>
                <div {...stylex.props(styles.hunkBar)}>
                  <span {...stylex.props(styles.mono, styles.hunkName)} title={hunk.header}>
                    {hunkLabel(hunk)}
                  </span>
                  <Button
                    label={hunk.staged ? 'Leave out' : 'Include'}
                    size="sm"
                    variant="ghost"
                    onClick={() => fixture.toggleHunk(selected.path, index)}
                  />
                </div>
                <Patch patch={hunkPatchOf(selected, index)} path={selected.path} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div {...stylex.props(styles.status)}>
        <span {...stylex.props(styles.branch)}>
          <Icon icon={GitBranch} size="sm" color="secondary" />
          <Text type="supporting" maxLines={1}>
            {BRANCH}
          </Text>
        </span>
        <Button
          label={fixture.ahead > 0 ? `Push ${fixture.ahead}` : 'Up to date'}
          size="sm"
          variant="ghost"
          icon={<Icon icon={ArrowUp} size="sm" />}
          isDisabled={fixture.ahead === 0}
          onClick={fixture.push}
        />
      </div>
    </div>
  );
}
