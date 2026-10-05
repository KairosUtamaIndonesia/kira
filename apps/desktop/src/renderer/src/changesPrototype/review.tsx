/**
 * PROTOTYPE — variant B, Review.
 *
 * The question it asks: a diff does not fit beside a list in 300px, so should
 * the pane stop pretending? The list is only an index. Opening a file gives the
 * whole pane to the diff, and the pane steps through the change set like a
 * review: previous and next file, stage the hunk, stage the file and move on.
 * Keys: j / k to move, s to stage and move on.
 */
import { Button } from '@astryxdesign/core/Button';
import { edgeCompSlot } from '@astryxdesign/core/Layout';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
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
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Circle,
  CircleCheck,
  CircleDashed,
  GitBranch,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  BRANCH,
  countsOf,
  fileState,
  type FixtureFile,
  hunkLabel,
  hunkPatchOf,
  statusOf,
  useFixture,
} from './fixture';
import { Counts, Letter, Patch } from './parts';
import { pathParts } from '../memoryGroups';
import { FileTypeIcon } from '../fileTypeIcon';

const EDGE_TEXT_BUTTON = edgeCompSlot.inset(spacingVars['--spacing-3']);

const styles = stylex.create({
  tab: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    minHeight: '100%',
  },
  between: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  branch: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
  },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  summary: { display: 'flex', alignItems: 'baseline', gap: spacingVars['--spacing-3'] },
  rows: { margin: 0, padding: 0, listStyle: 'none' },
  row: {
    borderBlockEndWidth: { default: borderVars['--border-width'], ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  item: {
    display: 'grid',
    gridTemplateColumns: '16px 16px minmax(0, 1fr) max-content',
    alignItems: 'center',
    columnGap: spacingVars['--spacing-2'],
    boxSizing: 'border-box',
    width: 'calc(100% + 16px)',
    minHeight: 48,
    marginInline: -8,
    paddingBlock: spacingVars['--spacing-1'],
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 0,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
    color: colorVars['--color-text-primary'],
    textAlign: 'start',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: '-2px',
  },
  stack: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  tail: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  fileHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlockEnd: spacingVars['--spacing-3'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  nameLine: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'], minWidth: 0 },
  facts: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-3'] },
  hunkBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    minHeight: 32,
  },
  hunkName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  hunks: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
  foot: {
    position: 'sticky',
    insetBlockEnd: 'calc(-1 * var(--spacing-4))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    marginBlockStart: 'auto',
    marginBlockEnd: 'calc(-1 * var(--spacing-4))',
    marginInline: 'calc(-1 * var(--spacing-4))',
    paddingBlock: spacingVars['--spacing-3'],
    paddingInline: spacingVars['--spacing-4'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  message: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: 56,
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
  commitBox: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  grow: { flex: 1 },
});

export function Review() {
  const fixture = useFixture();
  const [mode, setMode] = useState<'list' | 'review'>('list');
  const [tab, setTab] = useState<'changes' | 'history'>('changes');
  const [at, setAt] = useState(0);
  const [message, setMessage] = useState('');
  const files = fixture.files;
  const current = files[Math.min(at, files.length - 1)];

  const move = (by: number): void =>
    setAt((held) => Math.max(0, Math.min(files.length - 1, held + by)));
  const stageAndNext = (): void => {
    if (current === undefined) return;
    fixture.setFile(current.path, true);
    if (at >= files.length - 1) setMode('list');
    else move(1);
  };

  useEffect(() => {
    if (mode !== 'review') return;
    const onKey = (event: KeyboardEvent): void => {
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      if (event.key === 'j') move(1);
      if (event.key === 'k') move(-1);
      if (event.key === 's') stageAndNext();
    };
    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  });

  if (mode === 'review' && current !== undefined) {
    const state = fileState(current);
    const { name, folder } = pathParts(current.path);

    return (
      <div {...stylex.props(styles.tab)}>
        <div {...stylex.props(styles.between)}>
          <span {...stylex.props(EDGE_TEXT_BUTTON)}>
            <Button
              label="Changes"
              size="sm"
              variant="ghost"
              icon={<Icon icon={ArrowLeft} size="sm" />}
              onClick={() => setMode('list')}
            />
          </span>
          <span {...stylex.props(styles.facts)}>
            <span {...stylex.props(styles.mono)}>
              {at + 1} / {files.length}
            </span>
            <span>
              <IconButton
                label="Previous file (k)"
                icon={<Icon icon={ArrowUp} size="sm" />}
                isDisabled={at === 0}
                onClick={() => move(-1)}
              />
              <IconButton
                label="Next file (j)"
                icon={<Icon icon={ArrowDown} size="sm" />}
                isDisabled={at >= files.length - 1}
                onClick={() => move(1)}
              />
            </span>
          </span>
        </div>

        <div {...stylex.props(styles.fileHead)}>
          <div {...stylex.props(styles.nameLine)}>
            <FileTypeIcon name={name} kind="file" />
            <Text type="label" maxLines={1}>
              {name}
            </Text>
          </div>
          {folder !== '' && (
            <Text type="supporting" color="secondary" maxLines={1}>
              {folder}
            </Text>
          )}
          <div {...stylex.props(styles.facts)}>
            <Letter status={statusOf(current)} />
            <Counts item={current} />
            <Text type="supporting" color="secondary">
              {state === 'staged'
                ? 'Staged'
                : state === 'partial'
                  ? `${current.hunks.filter((hunk) => hunk.staged).length} of ${current.hunks.length} hunks staged`
                  : 'Not staged'}
            </Text>
          </div>
        </div>

        <div {...stylex.props(styles.hunks)}>
          {current.hunks.map((hunk, index) => (
            <div key={hunk.header}>
              <div {...stylex.props(styles.hunkBar)}>
                <span {...stylex.props(styles.hunkName)} title={hunk.header}>
                  {hunkLabel(hunk)}
                </span>
                <Button
                  label={hunk.staged ? 'Staged' : 'Stage hunk'}
                  size="sm"
                  variant={hunk.staged ? 'secondary' : 'ghost'}
                  icon={hunk.staged ? <Icon icon={CircleCheck} size="sm" /> : undefined}
                  onClick={() => fixture.toggleHunk(current.path, index)}
                />
              </div>
              <Patch patch={hunkPatchOf(current, index)} path={current.path} />
            </div>
          ))}
        </div>

        <div {...stylex.props(styles.grow)} />
        <div {...stylex.props(styles.foot)}>
          <Button
            label="Revert"
            size="sm"
            variant="ghost"
            isDisabled={current.status === '?'}
            onClick={() => {
              fixture.revert(current.path);
              setMode('list');
            }}
          />
          {state === 'staged' ? (
            <Button
              label={at >= files.length - 1 ? 'Done' : 'Next file'}
              size="sm"
              variant="primary"
              onClick={() => (at >= files.length - 1 ? setMode('list') : move(1))}
            />
          ) : (
            <Button label="Stage file & next" size="sm" variant="primary" onClick={stageAndNext} />
          )}
        </div>
      </div>
    );
  }

  const added = files.reduce((sum, item) => sum + countsOf(item).added, 0);
  const removed = files.reduce((sum, item) => sum + countsOf(item).removed, 0);

  return (
    <div {...stylex.props(styles.tab)}>
      <div {...stylex.props(styles.between)}>
        <span {...stylex.props(styles.branch)}>
          <Icon icon={GitBranch} size="sm" color="secondary" />
          <Text type="label" maxLines={1}>
            {BRANCH}
          </Text>
        </span>
        <Button
          label={fixture.ahead > 0 ? `Push ${fixture.ahead}` : 'Up to date'}
          size="sm"
          variant="ghost"
          isDisabled={fixture.ahead === 0}
          onClick={fixture.push}
        />
      </div>

      <SegmentedControl
        label="View"
        value={tab}
        onChange={(value) => setTab(value as 'changes' | 'history')}
        size="sm"
        layout="fill"
      >
        <SegmentedControlItem value="changes" label={`Changes ${files.length}`} />
        <SegmentedControlItem value="history" label="History" />
      </SegmentedControl>

      {tab === 'history' ? (
        <ul {...stylex.props(styles.rows)}>
          {fixture.history.map((commit) => (
            <li key={commit.short} {...stylex.props(styles.row)}>
              <div {...stylex.props(styles.stack)} style={{ paddingBlock: 8 }}>
                <Text type="label" maxLines={1}>
                  {commit.subject}
                </Text>
                <span {...stylex.props(styles.mono)}>
                  {commit.short} · {commit.author} · {commit.age}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : files.length === 0 ? (
        <Text type="supporting" color="secondary">
          Nothing has changed in this checkout.
        </Text>
      ) : (
        <>
          <div {...stylex.props(styles.between)}>
            <span {...stylex.props(styles.summary)}>
              <Text type="supporting" color="secondary">
                {files.length} files
              </Text>
              <span {...stylex.props(styles.mono)}>
                <span style={{ color: 'var(--color-text-green)' }}>+{added}</span>{' '}
                <span style={{ color: 'var(--color-text-red)' }}>−{removed}</span>
              </span>
            </span>
            <Button
              label="Review"
              size="sm"
              variant="secondary"
              onClick={() => {
                setAt(0);
                setMode('review');
              }}
            />
          </div>
          <ul {...stylex.props(styles.rows)}>
            {files.map((item, index) => (
              <li key={item.path} {...stylex.props(styles.row)}>
                <Item
                  item={item}
                  onOpen={() => {
                    setAt(index);
                    setMode('review');
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <div {...stylex.props(styles.grow)} />
      <div {...stylex.props(styles.foot)}>
        <div {...stylex.props(styles.commitBox)} style={{ width: '100%' }}>
          <textarea
            {...stylex.props(styles.message)}
            aria-label="Commit message"
            placeholder="Commit message"
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
          />
          <div {...stylex.props(styles.between)}>
            <Text type="supporting" color="secondary">
              {fixture.notice ?? `${fixture.committing} of ${files.length} staged`}
            </Text>
            <Button
              label="Commit"
              size="sm"
              variant="primary"
              isDisabled={fixture.committing === 0 || message.trim() === ''}
              onClick={() => {
                fixture.commit(message);
                setMessage('');
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Item({ item, onOpen }: { item: FixtureFile; onOpen: () => void }) {
  const state = fileState(item);
  const { name, folder } = pathParts(item.path);

  return (
    <button type="button" title={item.path} {...stylex.props(styles.item)} onClick={onOpen}>
      <Icon
        icon={state === 'staged' ? CircleCheck : state === 'partial' ? CircleDashed : Circle}
        size="sm"
        color={state === 'staged' ? 'accent' : 'secondary'}
      />
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
        <Counts item={item} />
        <Letter status={statusOf(item)} />
      </span>
    </button>
  );
}
