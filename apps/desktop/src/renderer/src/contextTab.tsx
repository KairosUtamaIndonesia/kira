/**
 * What Kira is holding, drawn as the workbench's Context tab.
 *
 * Not in the conversation and not part of it: this is the chat's memory of the
 * work — the goal, the files it touched, the commits, and what the person asked
 * for and corrected, with what Kira worked out from them above it — and it is
 * drawn outside the transcript because reading it must not become a turn.
 * Nothing here is sent to a model, and looking costs nothing.
 *
 * It is deliberately not the summary a compaction writes. That says where the
 * work stands; this is everything Kira was told, in the order Kira was told it,
 * and what Kira concluded from it, which is what a person checking Kira's memory
 * needs to see.
 *
 * Drawn as a ledger, the way Work is: a hairline and a heading per kind, a
 * zero-padded count, and ruled rows. What the person said and what Kira worked
 * out are prose; a file or a commit is a row to scan, and a file is a way into
 * the workspace. Files Kira only read are folded, since they are the longest list
 * and the one least worth checking.
 *
 * The pane around it — how wide it is, whether it is showing, the tab that names
 * it — belongs to the workbench, so nothing here draws a panel of its own.
 */
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  focusVars,
  radiusVars,
  spacingVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import type { ChatConclusion, ChatMemory, MemoryKind } from '../../preload/bridge';
import { FileTypeIcon } from './fileTypeIcon';
import {
  commitParts,
  conclusionGroupIn,
  coverageLine,
  groupsIn,
  opensInWorkspace,
  pathParts,
  sayingsIn,
  type ConclusionGroup,
} from './memoryGroups';

const styles = stylex.create({
  tab: {
    display: 'flex',
    flexDirection: 'column',
  },
  section: {
    paddingBlockEnd: spacingVars['--spacing-3'],
    borderBlockStartWidth: { default: borderVars['--border-width'], ':first-child': 0 },
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
    paddingBlockStart: { default: spacingVars['--spacing-3'], ':first-child': 0 },
  },
  heading: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-2'],
    width: '100%',
    paddingBlockEnd: spacingVars['--spacing-1'],
  },
  rows: {
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  row: {
    borderBlockEndWidth: { default: borderVars['--border-width'], ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  prose: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlock: spacingVars['--spacing-2'],
  },
  commit: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    alignItems: 'baseline',
    columnGap: spacingVars['--spacing-3'],
    minHeight: 32,
    paddingBlock: spacingVars['--spacing-1'],
  },
  /**
   * A file opens in the workspace, so it is a button. Its hover strip reaches past
   * the rule by the padding it has, which keeps the icon on the heading's left edge.
   */
  file: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    boxSizing: 'border-box',
    width: 'calc(100% + 16px)',
    minHeight: 32,
    marginInline: -8,
    paddingInline: spacingVars['--spacing-2'],
  },
  /** A file outside the folder is remembered but is no way in, so it is not a button. */
  fileButton: {
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
  fileName: { flexShrink: 0 },
  /** The folder gives way before the name does. */
  fileFolder: { flexShrink: 1, minWidth: 0 },
});

/** How many, always two figures wide, as Work draws a lane's count. */
function countOf(items: readonly unknown[]): string {
  return String(items.length).padStart(2, '0');
}

/** What Kira is holding for `memory`, or nothing while Kira is holding nothing. */
export function ContextTab({
  memory,
  conclusions,
  onOpenFile,
}: {
  memory: readonly ChatMemory[];
  conclusions: readonly ChatConclusion[];
  /** Open a remembered file in the workspace. */
  onOpenFile: (path: string) => void;
}) {
  const groups = groupsIn(memory);
  const concluded = conclusionGroupIn(conclusions);

  if (concluded === null && groups.length === 0) {
    return (
      <Text type="supporting" color="secondary">
        Nothing yet. Kira learns as you work.
      </Text>
    );
  }

  return (
    <div {...stylex.props(styles.tab)}>
      {concluded !== null && <Concluded group={concluded} />}
      {groups.map((group) =>
        group.kind === 'goal' ? (
          <Said key={group.kind} label={group.label} items={group.items} />
        ) : (
          <Section
            key={group.kind}
            label={group.label}
            count={countOf(group.items)}
            // The longest list and the least worth checking, so it starts folded.
            isFolded={group.kind === 'read'}
          >
            {group.items.map((item) => (
              <MemoryRow key={item.text} kind={group.kind} item={item} onOpenFile={onOpenFile} />
            ))}
          </Section>
        ),
      )}
    </div>
  );
}

/**
 * The work as it was asked for: one row per message, its lines stacked, rather
 * than a row per line. A change of plan says so above what it changed to.
 */
function Said({ label, items }: { label: string; items: readonly ChatMemory[] }) {
  const sayings = sayingsIn(items);

  return (
    <Section label={label} count={countOf(sayings)}>
      {sayings.map((saying) => (
        <li key={`${saying.at}:${saying.lines[0]}`} {...stylex.props(styles.row, styles.prose)}>
          {saying.isScopeChange && (
            <Text type="supporting" color="secondary">
              Scope change
            </Text>
          )}
          {saying.lines.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </li>
      ))}
    </Section>
  );
}

/**
 * What Kira worked out, above what Kira was told.
 *
 * First because the pane reads top-down most important first, and a conclusion
 * is what the things under it amounted to. Each one says how far it had read, so
 * a person can tell a conclusion drawn from the whole chat from one drawn early.
 */
function Concluded({ group }: { group: ConclusionGroup }) {
  return (
    <Section label={group.label} count={countOf(group.items)}>
      {group.items.map((conclusion) => (
        <Conclusion key={conclusion.text} conclusion={conclusion} />
      ))}
    </Section>
  );
}

function Conclusion({ conclusion }: { conclusion: ChatConclusion }) {
  const coverage = coverageLine(conclusion.coversThrough);

  return (
    <li {...stylex.props(styles.row, styles.prose)}>
      <Text>{conclusion.text}</Text>
      {coverage !== null && (
        <Text type="supporting" color="secondary">
          {coverage}
        </Text>
      )}
    </li>
  );
}

/**
 * A heading, how many are under it, and the list itself.
 *
 * The frame every kind is drawn in, so what a heading looks like and how a list
 * is ruled are decided once. What goes in the list is the caller's: a conclusion
 * carries how far it had read, and nothing Kira was told does.
 */
function Section({
  label,
  count,
  isFolded = false,
  children,
}: {
  label: string;
  count: string;
  /** Whether the list starts out put away behind its heading. */
  isFolded?: boolean;
  children: ReactNode;
}) {
  const heading = (
    <div {...stylex.props(styles.heading)}>
      <Text type="label" weight="medium">
        {label}
      </Text>
      <Text type="code" color="secondary">
        {count}
      </Text>
    </div>
  );
  const rows = (
    <ul aria-label={label} {...stylex.props(styles.rows)}>
      {children}
    </ul>
  );

  return (
    <section {...stylex.props(styles.section)}>
      {isFolded ? (
        <Collapsible trigger={heading} defaultIsOpen={false}>
          {rows}
        </Collapsible>
      ) : (
        <>
          {heading}
          {rows}
        </>
      )}
    </section>
  );
}

function MemoryRow({
  kind,
  item,
  onOpenFile,
}: {
  kind: MemoryKind;
  item: ChatMemory;
  onOpenFile: (path: string) => void;
}) {
  if (kind === 'changed' || kind === 'read') {
    const { name, folder } = pathParts(item.text);
    const file = (
      <>
        <FileTypeIcon name={name} kind="file" />
        <span {...stylex.props(styles.fileName)}>
          <Text type="label" color={kind === 'read' ? 'secondary' : 'primary'}>
            {name}
          </Text>
        </span>
        {folder !== '' && (
          <span {...stylex.props(styles.fileFolder)}>
            <Text type="supporting" color="secondary" maxLines={1}>
              {folder}
            </Text>
          </span>
        )}
      </>
    );

    return (
      <li {...stylex.props(styles.row)}>
        {opensInWorkspace(item.text) ? (
          <button
            type="button"
            title={item.text}
            {...stylex.props(styles.file, styles.fileButton)}
            onClick={() => onOpenFile(item.text)}
          >
            {file}
          </button>
        ) : (
          <div title={item.text} {...stylex.props(styles.file)}>
            {file}
          </div>
        )}
      </li>
    );
  }

  if (kind === 'commit') {
    const { hash, subject } = commitParts(item.text);

    return (
      <li {...stylex.props(styles.row, styles.commit)}>
        {hash !== '' && (
          <Text type="code" color="secondary">
            {hash}
          </Text>
        )}
        <Text maxLines={2}>{subject}</Text>
      </li>
    );
  }

  return (
    <li {...stylex.props(styles.row, styles.prose)}>
      <Text>{item.text}</Text>
    </li>
  );
}
