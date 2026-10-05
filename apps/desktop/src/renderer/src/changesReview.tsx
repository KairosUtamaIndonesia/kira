/**
 * The Changes view's review: one file's diff given the whole pane.
 *
 * A diff does not fit beside a list in a pane this narrow, so reading one leaves
 * the list. From here the pane steps through the change set — previous and next
 * file, stage a hunk, stage the file and move on — and keys do the same: `j` and
 * `k` move, `s` stages the file and moves on.
 *
 * A file that is partly staged shows its staged hunks (which unstage) and its
 * unstaged ones (which stage) together, each in the state git has it.
 */
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { edgeCompSlot } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowDown, ArrowLeft, ArrowUp, Check, CircleCheck, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { type ChangedFile, blocksOf } from './changesModel';
import { Counts, Letter, parts } from './changesParts';
import { DiffPatch, type DiffStyle } from './diffView';
import { FileTypeIcon } from './fileTypeIcon';
import { pathParts } from './memoryGroups';

const EDGE_TEXT_BUTTON = edgeCompSlot.inset(spacingVars['--spacing-3']);

/** What the review has read of the open file: its staged patch, its unstaged one, or why it could not. */
export interface ReviewPatches {
  staged: string | null;
  unstaged: string | null;
  trouble: string | null;
}

const styles = stylex.create({
  screen: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    flex: 1,
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
  steps: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-1'] },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlockEnd: spacingVars['--spacing-3'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  name: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'], minWidth: 0 },
  facts: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-3'] },
  factsEnd: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    marginInlineStart: 'auto',
  },
  blocks: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
  blockBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    minHeight: 32,
  },
  blockName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  grow: { flex: 1 },
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
});

export function ReviewScreen({
  file,
  position,
  total,
  patches,
  isBusy,
  diffStyle,
  wrap,
  isLast,
  onBack,
  onMove,
  onHunk,
  onStage,
  onUnstage,
  onRevert,
  onDiffStyle,
  onWrap,
}: {
  file: ChangedFile;
  /** Zero-based place in the change set. */
  position: number;
  total: number;
  /** Null while the patches are being read. */
  patches: ReviewPatches | null;
  isBusy: boolean;
  diffStyle: DiffStyle;
  wrap: boolean;
  isLast: boolean;
  onBack: () => void;
  onMove: (by: number) => void;
  /** Stage a hunk, or take it back out of the index. */
  onHunk: (patch: string, reverse: boolean) => void;
  /** Stage the whole file and move to the next. */
  onStage: () => void;
  onUnstage: () => void;
  onRevert: () => void;
  onDiffStyle: (style: DiffStyle) => void;
  onWrap: (wrap: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { name, folder } = pathParts(file.path);
  const blocks = [
    ...blocksOf(patches?.staged ?? null, true),
    ...blocksOf(patches?.unstaged ?? null, false),
  ];
  const canRevert = !file.isUntracked;

  return (
    <div {...stylex.props(styles.screen)}>
      <div {...stylex.props(styles.bar)}>
        <span {...stylex.props(EDGE_TEXT_BUTTON)}>
          <Button
            label="Changes"
            size="sm"
            variant="ghost"
            icon={<Icon icon={ArrowLeft} size="sm" />}
            onClick={onBack}
          />
        </span>
        <span {...stylex.props(styles.steps)}>
          <span {...stylex.props(parts.mono)}>
            {position + 1} / {total}
          </span>
          <IconButton
            label="Previous file (k)"
            icon={<Icon icon={ArrowUp} size="sm" />}
            isDisabled={position === 0}
            onClick={() => onMove(-1)}
          />
          <IconButton
            label="Next file (j)"
            icon={<Icon icon={ArrowDown} size="sm" />}
            isDisabled={isLast}
            onClick={() => onMove(1)}
          />
        </span>
      </div>

      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.name)}>
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
          <Letter status={file.status} />
          <Counts added={file.added} removed={file.removed} />
          <span {...stylex.props(styles.factsEnd)}>
            {file.state !== 'unstaged' && (
              <Button
                label="Unstage file"
                size="sm"
                variant="ghost"
                isDisabled={isBusy}
                onClick={onUnstage}
              />
            )}
            <DropdownMenu
              button={{
                label: 'Diff options',
                size: 'sm',
                variant: 'ghost',
                isIconOnly: true,
                icon: <Icon icon={Settings2} size="sm" />,
              }}
              items={[
                {
                  label: 'Inline',
                  endContent: diffStyle === 'unified' ? <Icon icon={Check} size="sm" /> : undefined,
                  onClick: () => onDiffStyle('unified'),
                },
                {
                  label: 'Side by side',
                  endContent: diffStyle === 'split' ? <Icon icon={Check} size="sm" /> : undefined,
                  onClick: () => onDiffStyle('split'),
                },
                { type: 'divider' },
                {
                  label: 'Wrap lines',
                  endContent: wrap ? <Icon icon={Check} size="sm" /> : undefined,
                  onClick: () => onWrap(!wrap),
                },
              ]}
            />
          </span>
        </div>
      </div>

      {patches?.trouble != null && (
        <Text type="supporting" color="secondary">
          {patches.trouble}
        </Text>
      )}
      {patches !== null && patches.trouble === null && blocks.length === 0 && (
        <Text type="supporting" color="secondary">
          This file has no changes to show.
        </Text>
      )}
      <div {...stylex.props(styles.blocks)}>
        {blocks.map((block) => (
          <div key={block.key}>
            <div {...stylex.props(styles.blockBar)}>
              <span {...stylex.props(styles.blockName)} title={block.label}>
                {block.label}
              </span>
              {!block.isWhole && (
                <Button
                  label={block.staged ? 'Staged' : 'Stage hunk'}
                  tooltip={block.staged ? 'Take this hunk out of the commit' : undefined}
                  size="sm"
                  variant={block.staged ? 'secondary' : 'ghost'}
                  icon={block.staged ? <Icon icon={CircleCheck} size="sm" /> : undefined}
                  isDisabled={isBusy}
                  onClick={() => onHunk(block.patch, block.staged)}
                />
              )}
            </div>
            <DiffPatch patch={block.patch} path={file.path} diffStyle={diffStyle} wrap={wrap} />
          </div>
        ))}
      </div>

      <div {...stylex.props(styles.grow)} />
      <div {...stylex.props(styles.foot)}>
        {confirming ? (
          <>
            <Text type="supporting">Discard these changes?</Text>
            <span {...stylex.props(styles.steps)}>
              <Button
                label="Cancel"
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
              />
              <Button
                label="Discard"
                size="sm"
                variant="destructive"
                isDisabled={isBusy}
                onClick={onRevert}
              />
            </span>
          </>
        ) : (
          <>
            <Button
              label="Revert"
              size="sm"
              variant="ghost"
              isDisabled={isBusy || !canRevert}
              onClick={() => setConfirming(true)}
            />
            {file.state === 'staged' ? (
              <Button
                label={isLast ? 'Done' : 'Next file'}
                size="sm"
                variant="primary"
                onClick={() => (isLast ? onBack() : onMove(1))}
              />
            ) : (
              <Button
                label={isLast ? 'Stage file' : 'Stage file & next'}
                size="sm"
                variant="primary"
                isDisabled={isBusy}
                onClick={onStage}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
