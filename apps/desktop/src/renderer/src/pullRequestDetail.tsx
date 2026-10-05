/**
 * An opened pull request, and one of its files' diffs.
 *
 * The request is read in three parts under one head — what it says (its
 * description and the comments on it), the files it changes, and the checks it
 * ran — because together they are a long scroll in a pane this narrow. A file
 * opens the way a changed file opens in the Changes view: its diff given the
 * whole pane, stepped through file by file. Nothing here writes; merging and
 * replying stay on the host.
 */
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { edgeCompSlot } from '@astryxdesign/core/Layout';
import { Markdown } from '@astryxdesign/core/Markdown';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  focusVars,
  radiusVars,
  spacingVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { LiveFile, LivePullRequest, LivePullRequestDetail } from '../../preload/bridge';
import { ageOf, blocksOf } from './changesModel';
import { Counts, Letter, parts } from './changesParts';
import { DiffOptionsMenu } from './diffOptions';
import { DiffPatch, type DiffStyle } from './diffView';
import { FileTypeIcon } from './fileTypeIcon';
import { pathParts } from './memoryGroups';
import { fileLetter, patchCounts } from './pullRequestsModel';
import { ChecksIcon, StateBadge } from './pullRequestsParts';

const EDGE_TEXT_BUTTON = edgeCompSlot.inset(spacingVars['--spacing-3']);

export type Section = 'about' | 'files' | 'checks';

const styles = stylex.create({
  screen: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
  barEnd: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-1'] },
  head: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  branches: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rows: { margin: 0, padding: 0, listStyle: 'none' },
  row: {
    borderBlockEndWidth: { default: borderVars['--border-width'], ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  fileOpen: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    boxSizing: 'border-box',
    width: 'calc(100% + 16px)',
    minHeight: 48,
    marginInline: -8,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 0,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
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
  check: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minHeight: 40,
    paddingBlock: spacingVars['--spacing-1'],
  },
  checkName: { flex: 1, minWidth: 0 },
  comment: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlock: spacingVars['--spacing-3'],
  },
  commentHead: { display: 'flex', alignItems: 'baseline', gap: spacingVars['--spacing-2'] },
  heading: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-2'],
    paddingBlockStart: spacingVars['--spacing-3'],
    paddingBlockEnd: spacingVars['--spacing-1'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  fileHead: {
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
  factsEnd: { marginInlineStart: 'auto' },
  blocks: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
  blockName: {
    minHeight: 28,
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

export function PullRequestScreen({
  request,
  detail,
  trouble,
  section,
  onSection,
  onBack,
  onRefresh,
  onOpenFile,
}: {
  /** The row it was opened from, so the head reads before the rest has arrived. */
  request: LivePullRequest;
  detail: LivePullRequestDetail | null;
  trouble: string | null;
  section: Section;
  onSection: (section: Section) => void;
  onBack: () => void;
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [now] = useState(Date.now);
  const state = detail?.state ?? request.state;
  const author = detail?.authorLogin ?? request.authorLogin;

  return (
    <div {...stylex.props(styles.screen)}>
      <div {...stylex.props(styles.bar)}>
        <span {...stylex.props(EDGE_TEXT_BUTTON)}>
          <Button
            label="Pull requests"
            size="sm"
            variant="ghost"
            icon={<Icon icon={ArrowLeft} size="sm" />}
            onClick={onBack}
          />
        </span>
        <span {...stylex.props(styles.barEnd)}>
          <IconButton
            label="Refresh"
            icon={<Icon icon={RefreshCw} size="sm" />}
            onClick={onRefresh}
          />
          <Button
            label="Open on the host"
            tooltip="Open on the host"
            isIconOnly
            size="sm"
            variant="ghost"
            icon={<Icon icon={ExternalLink} size="sm" />}
            href={request.url}
            target="_blank"
            rel="noreferrer"
          />
        </span>
      </div>

      <div {...stylex.props(styles.head)}>
        <span>
          <StateBadge state={state} />
        </span>
        <Text type="label">{detail?.title ?? request.title}</Text>
        <Text type="supporting" color="secondary">
          #{request.number}
          {author !== null && ` · ${author}`}
          {request.updatedAt !== null && ` · ${ageOf(request.updatedAt, now)}`}
        </Text>
        {detail !== null && (detail.head !== null || detail.base !== null) && (
          <span
            {...stylex.props(parts.mono, styles.branches)}
            title={`${detail.head} → ${detail.base}`}
          >
            {detail.head ?? '?'} → {detail.base ?? '?'}
          </span>
        )}
      </div>

      <SegmentedControl
        label="Part"
        value={section}
        onChange={(value) => onSection(value as Section)}
        size="sm"
        layout="fill"
      >
        <SegmentedControlItem value="about" label="About" />
        <SegmentedControlItem
          value="files"
          label={detail === null ? 'Files' : `Files ${detail.files.length}`}
        />
        <SegmentedControlItem
          value="checks"
          label={detail === null ? 'Checks' : `Checks ${detail.checks.length}`}
        />
      </SegmentedControl>

      {trouble !== null && (
        <Text type="supporting" color="secondary">
          {trouble}
        </Text>
      )}
      {trouble === null && detail === null && (
        <Text type="supporting" color="secondary">
          Reading the pull request…
        </Text>
      )}
      {detail !== null && section === 'about' && <About detail={detail} now={now} />}
      {detail !== null && section === 'files' && <Files files={detail.files} onOpen={onOpenFile} />}
      {detail !== null && section === 'checks' && <Checks detail={detail} />}
    </div>
  );
}

function About({ detail, now }: { detail: LivePullRequestDetail; now: number }) {
  return (
    <div>
      {detail.body.trim() === '' ? (
        <Text type="supporting" color="secondary">
          This pull request has no description.
        </Text>
      ) : (
        <Markdown density="compact" headingLevelStart={4}>
          {detail.body}
        </Markdown>
      )}
      {detail.comments.length > 0 && (
        <>
          <div {...stylex.props(styles.heading)}>
            <Text type="label">Comments</Text>
            <span {...stylex.props(parts.mono)}>
              {String(detail.comments.length).padStart(2, '0')}
            </span>
          </div>
          <ul {...stylex.props(styles.rows)}>
            {detail.comments.map((comment, at) => (
              <li key={at} {...stylex.props(styles.row, styles.comment)}>
                <div {...stylex.props(styles.commentHead)}>
                  <Text type="supporting" weight="medium">
                    {comment.authorLogin ?? 'someone'}
                  </Text>
                  {comment.createdAt !== null && (
                    <span {...stylex.props(parts.mono)}>{ageOf(comment.createdAt, now)}</span>
                  )}
                </div>
                <Markdown density="compact" headingLevelStart={5}>
                  {comment.body}
                </Markdown>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Files({ files, onOpen }: { files: readonly LiveFile[]; onOpen: (path: string) => void }) {
  if (files.length === 0) {
    return (
      <Text type="supporting" color="secondary">
        This pull request changes no files.
      </Text>
    );
  }

  return (
    <ul {...stylex.props(styles.rows)}>
      {files.map((file) => {
        const { name, folder } = pathParts(file.path);
        const counts = patchCounts(file.patch);

        return (
          <li key={file.path} {...stylex.props(styles.row)}>
            <button
              type="button"
              title={file.path}
              {...stylex.props(styles.fileOpen)}
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
                <Counts added={counts?.added ?? null} removed={counts?.removed ?? null} />
                <Letter status={fileLetter(file.status)} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Checks({ detail }: { detail: LivePullRequestDetail }) {
  if (detail.checks.length === 0) {
    return (
      <Text type="supporting" color="secondary">
        The host reported no checks for this pull request.
      </Text>
    );
  }

  return (
    <ul {...stylex.props(styles.rows)}>
      {detail.checks.map((check, at) => (
        <li key={at} {...stylex.props(styles.row, styles.check)}>
          <ChecksIcon state={check.state} />
          <span {...stylex.props(styles.checkName)}>
            <Text type="supporting" maxLines={2}>
              {check.context}
            </Text>
          </span>
          <span {...stylex.props(parts.mono)}>{check.state}</span>
        </li>
      ))}
    </ul>
  );
}

/** One file of an opened request, its diff given the whole pane. */
export function PullRequestFileScreen({
  files,
  path,
  diffStyle,
  wrap,
  onBack,
  onMove,
  onDiffStyle,
  onWrap,
}: {
  files: readonly LiveFile[];
  path: string;
  diffStyle: DiffStyle;
  wrap: boolean;
  onBack: () => void;
  onMove: (by: number) => void;
  onDiffStyle: (style: DiffStyle) => void;
  onWrap: (wrap: boolean) => void;
}) {
  const at = files.findIndex((file) => file.path === path);
  const file = files[at];
  if (file === undefined) return null;

  const { name, folder } = pathParts(file.path);
  const counts = patchCounts(file.patch);
  const blocks = blocksOf(file.patch, false);

  return (
    <div {...stylex.props(styles.screen)}>
      <div {...stylex.props(styles.bar)}>
        <span {...stylex.props(EDGE_TEXT_BUTTON)}>
          <Button
            label="Files"
            size="sm"
            variant="ghost"
            icon={<Icon icon={ArrowLeft} size="sm" />}
            onClick={onBack}
          />
        </span>
        <span {...stylex.props(styles.barEnd)}>
          <span {...stylex.props(parts.mono)}>
            {at + 1} / {files.length}
          </span>
          <IconButton
            label="Previous file (k)"
            icon={<Icon icon={ArrowUp} size="sm" />}
            isDisabled={at === 0}
            onClick={() => onMove(-1)}
          />
          <IconButton
            label="Next file (j)"
            icon={<Icon icon={ArrowDown} size="sm" />}
            isDisabled={at === files.length - 1}
            onClick={() => onMove(1)}
          />
        </span>
      </div>

      <div {...stylex.props(styles.fileHead)}>
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
          <Letter status={fileLetter(file.status)} />
          <Counts added={counts?.added ?? null} removed={counts?.removed ?? null} />
          <span {...stylex.props(styles.factsEnd)}>
            <DiffOptionsMenu
              diffStyle={diffStyle}
              wrap={wrap}
              onDiffStyle={onDiffStyle}
              onWrap={onWrap}
            />
          </span>
        </div>
      </div>

      {blocks.length === 0 && (
        <Text type="supporting" color="secondary">
          This file has no diff to show.
        </Text>
      )}
      <div {...stylex.props(styles.blocks)}>
        {blocks.map((block) => (
          <div key={block.key}>
            <span {...stylex.props(parts.mono, styles.blockName)} title={block.label}>
              {block.label}
            </span>
            <DiffPatch patch={block.patch} path={file.path} diffStyle={diffStyle} wrap={wrap} />
          </div>
        ))}
      </div>
    </div>
  );
}
