/**
 * PROTOTYPE — throwaway. Three ways to show a ticket's branch and execution workspace in
 * the full view's floating box, switchable from a development-only bar.
 *
 * Question it answers: what should the box say about where the work happens, in each
 * state a workspace can be in? The bar can swap in an in-memory workspace in any of those
 * states, so each layout can be judged on all of them. Nothing here writes: actions are
 * stubs that say so, except "Open workspace", which scrolls to the full panel in the
 * document. Once a layout wins, rewrite it properly and drop this file from main.
 */
import { Icon } from '@astryxdesign/core/Icon';
import {
  colorVars,
  focusVars,
  shadowVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ArrowDown,
  ArrowRight,
  Copy,
  Folder,
  GitBranch,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { ExecutionWorkspace, Ticket, TicketRun } from '../../preload/bridge.ts';
import {
  executionWorkspaceView,
  type ExecutionStatus,
  type ExecutionWorkspaceView,
} from './executionWorkspace.ts';

export const BRANCH_VARIANTS = [
  { id: 'card', label: 'Status card' },
  { id: 'graph', label: 'Branch line' },
  { id: 'rows', label: 'Ledger rows' },
] as const;
export type BranchVariant = (typeof BRANCH_VARIANTS)[number]['id'];

export const BRANCH_STATES = [
  { id: 'real', label: 'Real' },
  { id: 'none', label: 'No workspace' },
  { id: 'not-started', label: 'Not started' },
  { id: 'running', label: 'Running' },
  { id: 'completed', label: 'Finished' },
  { id: 'failed', label: 'Failed' },
] as const;
export type BranchState = (typeof BRANCH_STATES)[number]['id'];

export function BranchPrototypeSwitcher({
  variant,
  state,
  note,
  onVariant,
  onState,
}: {
  variant: BranchVariant;
  state: BranchState;
  note: string | null;
  onVariant: (next: BranchVariant) => void;
  onState: (next: BranchState) => void;
}) {
  return (
    <div {...stylex.props(ui.switcher)} role="toolbar" aria-label="Branch block prototypes">
      <fieldset aria-label="Layout" {...stylex.props(ui.segments)}>
        {BRANCH_VARIANTS.map((each, index) => (
          <button
            key={each.id}
            type="button"
            aria-pressed={each.id === variant}
            {...stylex.props(ui.segment, each.id === variant && ui.segmentOn)}
            onClick={() => onVariant(each.id)}
          >
            {String.fromCharCode(65 + index)} · {each.label}
          </button>
        ))}
      </fieldset>
      <span {...stylex.props(ui.divider)} aria-hidden />
      <fieldset aria-label="Workspace state" {...stylex.props(ui.segments)}>
        {BRANCH_STATES.map((each) => (
          <button
            key={each.id}
            type="button"
            aria-pressed={each.id === state}
            {...stylex.props(ui.segment, each.id === state && ui.segmentOn)}
            onClick={() => onState(each.id)}
          >
            {each.label}
          </button>
        ))}
      </fieldset>
      {note !== null && <span {...stylex.props(ui.note)}>{note}</span>}
    </div>
  );
}

/** The ticket and workspaces the box draws, with the chosen sample state swapped in. */
export function withBranchState(
  ticket: Ticket,
  workspaces: ExecutionWorkspace[],
  state: BranchState,
): { ticket: Ticket; workspaces: ExecutionWorkspace[] } {
  if (state === 'real') return { ticket, workspaces };
  if (state === 'none') return { ticket: { ...ticket, runs: [] }, workspaces: [] };

  const now = Date.now();
  const ago = (minutes: number): string => new Date(now - minutes * 60_000).toISOString();
  const workspace: ExecutionWorkspace = {
    id: 'sample-workspace',
    ticketId: ticket.id,
    repository: '/home/brandon/Workspace/demo',
    baseBranch: 'main',
    branch: ticket.branch,
    agentConfig: 'default',
    createdAt: ago(90),
  };
  const run: TicketRun = {
    id: 'sample-run',
    ticketId: ticket.id,
    workerId: 'sample-worker',
    startedAt: ago(state === 'running' ? 6 : 52),
    endedAt: state === 'running' ? null : ago(18),
    branch: ticket.branch,
    stoppedBecause: state === 'failed' ? 'the typecheck failed and it could not fix it' : null,
    changed: 'Six files: page shell, form wiring, labels, and two tests.',
    checks: ['bun test — 42 passed', 'typecheck — clean'],
    made: null,
    verdict: null,
  };
  return {
    ticket: { ...ticket, runs: state === 'not-started' ? [] : [run] },
    workspaces: [workspace],
  };
}

/* ── What every layout reads ────────────────────────────────────────────── */

interface BlockProps {
  ticket: Ticket;
  workspaces: ExecutionWorkspace[];
  onJump: () => void;
  onStub: (action: string) => void;
}

export function BranchBlockPrototype(props: BlockProps & { variant: BranchVariant }) {
  if (props.variant === 'graph') return <GraphBlock {...props} />;
  if (props.variant === 'rows') return <RowsBlock {...props} />;
  return <CardBlock {...props} />;
}

const STATUS_WORDS: Record<ExecutionStatus, string> = {
  'not-started': 'Not started',
  running: 'Agent working',
  completed: 'Ready to review',
  failed: 'Stopped',
};

/** A long branch keeps its start and its end, which is where two branches differ. */
function middle(text: string, keep = 30): string {
  if (text.length <= keep) return text;
  const head = Math.ceil((keep - 1) * 0.6);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - 1 - head))}`;
}

/** A path under the home folder reads from `~`, the way a terminal would show it. */
function tilde(path: string): string {
  return path.replace(/^\/(home|Users)\/[^/]+/, '~').replace(/\/$/, '');
}

function Dot({ status }: { status: ExecutionStatus }) {
  return (
    <span
      aria-hidden
      {...stylex.props(
        ui.dot,
        status === 'running' && ui.dotRunning,
        status === 'completed' && ui.dotDone,
        status === 'failed' && ui.dotFailed,
      )}
    />
  );
}

function CopyButton({ text, onStub }: { text: string; onStub: (action: string) => void }) {
  return (
    <button
      type="button"
      aria-label={`Copy ${text}`}
      title={`Copy ${text}`}
      {...stylex.props(ui.iconButton)}
      onClick={() => onStub('Copy branch')}
    >
      <Icon icon={Copy} size="xsm" />
    </button>
  );
}

function LinkAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button type="button" {...stylex.props(ui.link)} onClick={onClick}>
      {label}
      <Icon icon={icon} size="xsm" />
    </button>
  );
}

function noWorkspaceAction(onStub: (action: string) => void) {
  return (
    <LinkAction
      label="Set up a workspace"
      icon={Plus}
      onClick={() => onStub('Set up a workspace')}
    />
  );
}

/* ── A. Status card ─────────────────────────────────────────────────────── */

function CardBlock({ ticket, workspaces, onJump, onStub }: BlockProps) {
  const view: ExecutionWorkspaceView | null =
    workspaces[0] === undefined ? null : executionWorkspaceView(workspaces[0], ticket);
  const branch = view?.branch ?? ticket.branch;

  return (
    <section {...stylex.props(ui.block)} aria-label="Branch and workspace">
      <h3 {...stylex.props(ui.head)}>Workspace</h3>
      <div {...stylex.props(card.card, view !== null && card[view.status])}>
        <span {...stylex.props(card.status)}>
          {view === null ? (
            <span {...stylex.props(ui.secondary)}>No workspace yet</span>
          ) : (
            <>
              <Dot status={view.status} />
              {STATUS_WORDS[view.status]}
            </>
          )}
        </span>
        <span {...stylex.props(card.branch)} title={branch}>
          <Icon icon={GitBranch} size="xsm" />
          <span {...stylex.props(ui.mono, ui.grow)}>{middle(branch, 26)}</span>
          <CopyButton text={branch} onStub={onStub} />
        </span>
        {view !== null && (
          <span {...stylex.props(ui.secondary)} title={view.repository}>
            {tilde(view.repository)} · from {view.workspace.baseBranch}
          </span>
        )}
        {view?.changed !== null && view?.changed !== undefined && (
          <span {...stylex.props(card.changed)}>{view.changed}</span>
        )}
      </div>
      {view === null ? (
        noWorkspaceAction(onStub)
      ) : (
        <LinkAction label="Open workspace" icon={ArrowDown} onClick={onJump} />
      )}
      {workspaces.length > 1 && (
        <span {...stylex.props(ui.secondary)}>+{workspaces.length - 1} more workspaces</span>
      )}
    </section>
  );
}

/* ── B. Branch line ─────────────────────────────────────────────────────── */

function GraphBlock({ ticket, workspaces, onJump, onStub }: BlockProps) {
  const view = workspaces[0] === undefined ? null : executionWorkspaceView(workspaces[0], ticket);
  const branch = view?.branch ?? ticket.branch;

  return (
    <section {...stylex.props(ui.block)} aria-label="Branch and workspace">
      <h3 {...stylex.props(ui.head)}>Branch</h3>
      <div {...stylex.props(graph.line)}>
        <span {...stylex.props(graph.pill, graph.base)}>
          {view?.workspace.baseBranch ?? 'main'}
        </span>
        <span {...stylex.props(graph.arrow)}>
          <Icon icon={ArrowRight} size="xsm" />
        </span>
        <span
          {...stylex.props(graph.pill, graph.work, view === null && graph.planned)}
          title={branch}
        >
          {middle(branch, 20)}
        </span>
        <CopyButton text={branch} onStub={onStub} />
      </div>
      <ul {...stylex.props(graph.facts)}>
        <li {...stylex.props(graph.fact)}>
          {view === null ? (
            <span {...stylex.props(ui.secondary)}>
              Named, not made — a run makes it, or work it by hand.
            </span>
          ) : (
            <>
              <Dot status={view.status} />
              <span>{STATUS_WORDS[view.status]}</span>
              {view.run?.endedAt === null && <span {...stylex.props(ui.secondary)}>· now</span>}
            </>
          )}
        </li>
        {view !== null && (
          <li {...stylex.props(graph.fact)} title={view.repository}>
            <Icon icon={Folder} size="xsm" />
            <span {...stylex.props(ui.secondary)}>{tilde(view.repository)}</span>
          </li>
        )}
      </ul>
      {view === null ? (
        noWorkspaceAction(onStub)
      ) : (
        <LinkAction label="Open workspace" icon={ArrowDown} onClick={onJump} />
      )}
    </section>
  );
}

/* ── C. Ledger rows ─────────────────────────────────────────────────────── */

function RowsBlock({ ticket, workspaces, onJump, onStub }: BlockProps) {
  const view = workspaces[0] === undefined ? null : executionWorkspaceView(workspaces[0], ticket);
  const branch = view?.branch ?? ticket.branch;
  const rows: { label: string; value: ReactNode; title?: string }[] = [
    {
      label: 'Workspace',
      value:
        view === null ? (
          <span {...stylex.props(ui.secondary)}>None yet</span>
        ) : (
          <span {...stylex.props(rowsStyles.status)}>
            <Dot status={view.status} />
            {STATUS_WORDS[view.status]}
          </span>
        ),
    },
    {
      label: 'Branch',
      title: branch,
      value: (
        <span {...stylex.props(rowsStyles.branch)}>
          <span {...stylex.props(ui.mono, ui.grow)}>{middle(branch, 18)}</span>
          <CopyButton text={branch} onStub={onStub} />
        </span>
      ),
    },
    ...(view === null
      ? []
      : [
          {
            label: 'From',
            value: <span {...stylex.props(ui.mono)}>{view.workspace.baseBranch}</span>,
          },
          {
            label: 'Checkout',
            title: view.repository,
            value: <span {...stylex.props(ui.ellipsis)}>{tilde(view.repository)}</span>,
          },
          {
            label: 'Agent',
            value:
              view.workspace.agentConfig === 'default'
                ? 'Default model'
                : view.workspace.agentConfig,
          },
        ]),
  ];

  return (
    <section {...stylex.props(ui.block)} aria-label="Branch and workspace">
      <dl {...stylex.props(rowsStyles.list)}>
        {rows.map((row) => (
          <div key={row.label} {...stylex.props(rowsStyles.row)} title={row.title}>
            <dt {...stylex.props(rowsStyles.label)}>{row.label}</dt>
            <dd {...stylex.props(rowsStyles.value)}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {view === null ? (
        noWorkspaceAction(onStub)
      ) : (
        <LinkAction label="Open workspace" icon={ArrowDown} onClick={onJump} />
      )}
    </section>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const ui = stylex.create({
  block: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
  },
  head: {
    margin: 0,
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 600,
    color: colorVars['--color-text-secondary'],
  },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    whiteSpace: 'nowrap',
  },
  // Branches are shortened in the middle by `middle`, so the box never adds its own ellipsis.
  grow: { flex: 1, minWidth: 0, overflow: 'hidden' },
  ellipsis: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  secondary: {
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  dot: {
    display: 'inline-block',
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: 999,
    backgroundColor: colorVars['--color-icon-secondary'],
  },
  dotRunning: { backgroundColor: colorVars['--color-icon-blue'] },
  dotDone: { backgroundColor: colorVars['--color-success'] },
  dotFailed: { backgroundColor: colorVars['--color-error'] },
  iconButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 22,
    height: 22,
    padding: 0,
    borderWidth: 0,
    borderRadius: 4,
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
    color: {
      default: colorVars['--color-icon-secondary'],
      ':hover': colorVars['--color-text-primary'],
    },
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colorVars['--color-text-accent'],
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 600,
    textDecorationLine: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 3,
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: 2,
  },
  switcher: {
    position: 'fixed',
    insetBlockEnd: 16,
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    maxWidth: 'calc(100vw - 32px)',
    padding: spacingVars['--spacing-1'],
    paddingInline: spacingVars['--spacing-2'],
    borderRadius: 999,
    backgroundColor: colorVars['--color-background-inverted'],
    color: colorVars['--color-background-surface'],
    boxShadow: shadowVars['--shadow-high'],
    fontSize: textSizeVars['--font-size-sm'],
    overflowX: 'auto',
  },
  segments: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    minWidth: 0,
  },
  segment: {
    height: 24,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: { default: 'transparent', ':hover': 'rgb(128 128 128 / 0.25)' },
    color: 'inherit',
    fontSize: textSizeVars['--font-size-sm'],
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  segmentOn: {
    backgroundColor: {
      default: colorVars['--color-accent'],
      ':hover': colorVars['--color-accent'],
    },
    color: colorVars['--color-on-accent'],
  },
  divider: {
    width: 1,
    height: 16,
    marginInline: spacingVars['--spacing-1'],
    backgroundColor: 'rgb(128 128 128 / 0.5)',
  },
  note: { paddingInline: spacingVars['--spacing-2'], opacity: 0.8, whiteSpace: 'nowrap' },
});

const card = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1-5'],
    alignSelf: 'stretch',
    minWidth: 0,
    padding: spacingVars['--spacing-3'],
    borderRadius: 8,
    backgroundColor: colorVars['--color-background-muted'],
  },
  'not-started': {},
  running: { backgroundColor: 'color-mix(in srgb, var(--color-icon-blue) 10%, transparent)' },
  completed: { backgroundColor: colorVars['--color-success-muted'] },
  failed: { backgroundColor: colorVars['--color-error-muted'] },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    fontSize: textSizeVars['--font-size-base'],
    fontWeight: 600,
  },
  branch: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1-5'],
    minWidth: 0,
    color: colorVars['--color-icon-secondary'],
  },
  changed: {
    paddingBlockStart: spacingVars['--spacing-1'],
    fontSize: textSizeVars['--font-size-sm'],
    lineHeight: 1.5,
    color: colorVars['--color-text-primary'],
  },
});

const graph = stylex.create({
  line: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    alignSelf: 'stretch',
    minWidth: 0,
  },
  pill: {
    height: 22,
    paddingInline: 7,
    borderRadius: 4,
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    lineHeight: '22px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  base: {
    flexShrink: 0,
    color: colorVars['--color-text-secondary'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  work: {
    minWidth: 0,
    color: colorVars['--color-text-primary'],
    backgroundColor: colorVars['--color-neutral'],
  },
  planned: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colorVars['--color-border-emphasized'],
    backgroundColor: 'transparent',
    lineHeight: '20px',
  },
  arrow: { display: 'inline-flex', color: colorVars['--color-icon-secondary'], flexShrink: 0 },
  facts: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
    minWidth: 0,
    alignSelf: 'stretch',
  },
  fact: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-icon-secondary'],
  },
});

const rowsStyles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    alignSelf: 'stretch',
    margin: 0,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '96px minmax(0, 1fr)',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minHeight: 22,
  },
  label: { fontSize: textSizeVars['--font-size-sm'], color: colorVars['--color-text-secondary'] },
  value: {
    display: 'flex',
    minWidth: 0,
    margin: 0,
    fontSize: textSizeVars['--font-size-sm'],
  },
  status: { display: 'inline-flex', alignItems: 'center', gap: spacingVars['--spacing-2'] },
  branch: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    minWidth: 0,
    flex: 1,
  },
});
