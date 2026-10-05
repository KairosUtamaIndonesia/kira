/**
 * PROTOTYPE — variant A, Ledger.
 *
 * The question it asks: if Changes is drawn the way Context and Work are — ruled
 * sections with a mono count, 32px rows, nothing boxed — does a long list stay
 * readable in a narrow pane? A file's diff opens in its own row, so the list and
 * the thing you are reading never leave each other. The commit is pinned to the
 * foot of the pane, where the thumb-of-the-eye ends.
 */
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { edgeCompSlot } from '@astryxdesign/core/Layout';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  focusVars,
  radiusVars,
  spacingVars,
  typographyVars,
  textSizeVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUp, ChevronRight, Ellipsis, GitBranch, Minus, Plus, RotateCcw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  BRANCH,
  fileState,
  type FixtureFile,
  hunkLabel,
  hunkPatchOf,
  statusOf,
  useFixture,
} from './fixture';
import { Count, Counts, FileLabel, Letter, Patch } from './parts';

const EDGE_TEXT_BUTTON = edgeCompSlot.inset(spacingVars['--spacing-3']);

const styles = stylex.create({
  tab: { display: 'flex', flexDirection: 'column', minHeight: '100%' },
  top: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    paddingBlockEnd: spacingVars['--spacing-3'],
  },
  branchBox: { flex: 1, minWidth: 0 },
  topEnd: { flexShrink: 0, display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-1'] },
  section: {
    paddingBlockStart: spacingVars['--spacing-3'],
    paddingBlockEnd: spacingVars['--spacing-2'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  heading: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-2'],
    minHeight: 28,
    paddingBlockEnd: spacingVars['--spacing-1'],
  },
  headingAction: { marginInlineStart: 'auto', alignSelf: 'center' },
  fold: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-2'],
    width: '100%',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
  },
  rows: { margin: 0, padding: 0, listStyle: 'none' },
  row: {
    borderBlockEndWidth: { default: borderVars['--border-width'], ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  line: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    boxSizing: 'border-box',
    width: 'calc(100% + 16px)',
    minHeight: 32,
    marginInline: -8,
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
  lineOpen: { backgroundColor: colorVars['--color-background-muted'] },
  labels: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    flex: 1,
    minWidth: 0,
  },
  tail: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    flexShrink: 0,
    minWidth: 52,
    justifyContent: 'flex-end',
  },
  partial: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  strip: {
    position: 'absolute',
    insetBlock: 2,
    insetInlineEnd: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    paddingInline: 2,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: colorVars['--color-background-popover'],
    boxShadow: 'var(--shadow-med)',
  },
  hunks: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    paddingBlock: spacingVars['--spacing-2'],
  },
  hunkBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    minHeight: 28,
  },
  hunkName: {
    minWidth: 0,
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  history: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr max-content',
    alignItems: 'baseline',
    columnGap: spacingVars['--spacing-3'],
    minHeight: 32,
    paddingBlock: spacingVars['--spacing-1'],
  },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  grow: { flex: 1 },
  foot: {
    position: 'sticky',
    insetBlockEnd: 'calc(-1 * var(--spacing-4))',
    display: 'flex',
    flexDirection: 'column',
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
  commitRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});

export function Ledger() {
  const fixture = useFixture();
  const [open, setOpen] = useState<string | null>(
    'apps/desktop/src/renderer/src/pullRequestsTab.tsx',
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [branch, setBranch] = useState(BRANCH);
  const total = fixture.files.length;

  return (
    <div {...stylex.props(styles.tab)}>
      <div {...stylex.props(styles.top)}>
        <div {...stylex.props(styles.branchBox)}>
          <Selector
            width="100%"
            label="Branch"
            isLabelHidden
            options={[BRANCH, 'main', 'agent/dummy-pr', 'agent/markdown-autolink'].map((each) => ({
              value: each,
              label: each,
            }))}
            value={branch}
            onChange={setBranch}
            variant="ghost"
            size="sm"
            hasSearch
            searchPlaceholder="Search branches…"
            startIcon={GitBranch}
          />
        </div>
        <div {...stylex.props(styles.topEnd)}>
          <Button
            label={fixture.ahead > 0 ? String(fixture.ahead) : '0'}
            tooltip={fixture.ahead > 0 ? `Push ${fixture.ahead} commits` : 'Nothing to push'}
            size="sm"
            variant="ghost"
            icon={<Icon icon={ArrowUp} size="sm" />}
            isDisabled={fixture.ahead === 0}
            onClick={fixture.push}
          />
          <DropdownMenu
            button={{
              label: 'More',
              size: 'sm',
              variant: 'ghost',
              isIconOnly: true,
              icon: <Icon icon={Ellipsis} size="sm" />,
            }}
            items={[{ label: 'Fetch' }, { label: 'Pull' }]}
          />
        </div>
      </div>

      {total === 0 ? (
        <Section label="Changes" n={0}>
          <Text type="supporting" color="secondary">
            Nothing has changed in this checkout.
          </Text>
        </Section>
      ) : null}

      {fixture.staged.length > 0 && (
        <Section
          label="Staged"
          n={fixture.staged.length}
          action={
            <span {...stylex.props(EDGE_TEXT_BUTTON)}>
              <Button
                label="Unstage all"
                size="sm"
                variant="ghost"
                onClick={() => fixture.setAll(false)}
              />
            </span>
          }
        >
          {fixture.staged.map((item) => (
            <Row key={item.path} item={item} open={open} setOpen={setOpen} fixture={fixture} />
          ))}
        </Section>
      )}
      {fixture.changes.length > 0 && (
        <Section
          label="Changes"
          n={fixture.changes.length}
          action={
            <span {...stylex.props(EDGE_TEXT_BUTTON)}>
              <Button
                label="Stage all"
                size="sm"
                variant="ghost"
                onClick={() => fixture.setAll(true)}
              />
            </span>
          }
        >
          {fixture.changes.map((item) => (
            <Row key={item.path} item={item} open={open} setOpen={setOpen} fixture={fixture} />
          ))}
        </Section>
      )}
      {fixture.untracked.length > 0 && (
        <Section label="Untracked" n={fixture.untracked.length}>
          {fixture.untracked.map((item) => (
            <Row key={item.path} item={item} open={open} setOpen={setOpen} fixture={fixture} />
          ))}
        </Section>
      )}

      <section {...stylex.props(styles.section)}>
        <button
          type="button"
          {...stylex.props(styles.fold)}
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((held) => !held)}
        >
          <Icon icon={historyOpen ? Minus : ChevronRight} size="sm" color="secondary" />
          <Text type="label">History</Text>
          <Count n={fixture.history.length} />
        </button>
        {historyOpen && (
          <ul {...stylex.props(styles.rows)}>
            {fixture.history.map((commit) => (
              <li key={commit.short} {...stylex.props(styles.row, styles.history)}>
                <span {...stylex.props(styles.mono)}>{commit.short}</span>
                <Text type="supporting" maxLines={1}>
                  {commit.subject}
                </Text>
                <span {...stylex.props(styles.mono)}>{commit.age}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div {...stylex.props(styles.grow)} />
      <div {...stylex.props(styles.foot)}>
        <textarea
          {...stylex.props(styles.message)}
          aria-label="Commit message"
          placeholder="Commit message"
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
        />
        <div {...stylex.props(styles.commitRow)}>
          <Text type="supporting" color="secondary">
            {fixture.notice ??
              (fixture.committing === 0 ? 'Nothing staged' : `${fixture.committing} staged`)}
          </Text>
          <Button
            label={fixture.committing > 1 ? `Commit ${fixture.committing} files` : 'Commit'}
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
  );
}

function Section({
  label,
  n,
  action,
  children,
}: {
  label: string;
  n: number;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.heading)}>
        <Text type="label">{label}</Text>
        <Count n={n} />
        {action !== undefined && <span {...stylex.props(styles.headingAction)}>{action}</span>}
      </div>
      <ul {...stylex.props(styles.rows)}>{children}</ul>
    </section>
  );
}

function Row({
  item,
  open,
  setOpen,
  fixture,
}: {
  item: FixtureFile;
  open: string | null;
  setOpen: (path: string | null) => void;
  fixture: ReturnType<typeof useFixture>;
}) {
  const [over, setOver] = useState(false);
  const state = fileState(item);
  const isOpen = open === item.path;
  const stagedHunks = item.hunks.filter((hunk) => hunk.staged).length;

  return (
    <li {...stylex.props(styles.row)}>
      <div
        role="presentation"
        style={{ position: 'relative' }}
        onPointerEnter={() => setOver(true)}
        onPointerLeave={() => setOver(false)}
        onFocus={() => setOver(true)}
        onBlur={() => setOver(false)}
      >
        <button
          type="button"
          title={item.path}
          aria-expanded={isOpen}
          {...stylex.props(styles.line, isOpen && styles.lineOpen)}
          onClick={() => setOpen(isOpen ? null : item.path)}
        >
          <span {...stylex.props(styles.labels)}>
            <FileLabel path={item.path} />
          </span>
          <span {...stylex.props(styles.tail)}>
            {state === 'partial' && (
              <span {...stylex.props(styles.partial)} title="Hunks staged">
                {stagedHunks}/{item.hunks.length}
              </span>
            )}
            <Counts item={item} />
            <Letter status={statusOf(item)} />
          </span>
        </button>
        {over && (
          <span {...stylex.props(styles.strip)}>
            {state === 'staged' ? (
              <IconButton
                label="Unstage file"
                icon={<Icon icon={Minus} size="sm" />}
                onClick={() => fixture.setFile(item.path, false)}
              />
            ) : (
              <IconButton
                label="Stage file"
                icon={<Icon icon={Plus} size="sm" />}
                onClick={() => fixture.setFile(item.path, true)}
              />
            )}
            {item.status !== '?' && (
              <IconButton
                label="Revert file"
                icon={<Icon icon={RotateCcw} size="sm" />}
                onClick={() => fixture.revert(item.path)}
              />
            )}
          </span>
        )}
      </div>
      {isOpen && (
        <div {...stylex.props(styles.hunks)}>
          {item.hunks.map((hunk, at) => (
            <div key={hunk.header}>
              <div {...stylex.props(styles.hunkBar)}>
                <span {...stylex.props(styles.hunkName)} title={hunk.header}>
                  {hunkLabel(hunk)}
                </span>
                <Button
                  label={hunk.staged ? 'Unstage hunk' : 'Stage hunk'}
                  size="sm"
                  variant="ghost"
                  onClick={() => fixture.toggleHunk(item.path, at)}
                />
              </div>
              <Patch patch={hunkPatchOf(item, at)} path={item.path} />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
