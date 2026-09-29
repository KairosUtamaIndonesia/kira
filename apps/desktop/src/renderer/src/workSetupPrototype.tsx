/**
 * PROTOTYPE — throwaway. Three ways to set up a ticket's execution workspace, drawn where
 * the full form sits today when a ticket has none, switchable from a development-only bar.
 *
 * Question it answers: the four choices (checkout, base branch, work branch, agent) almost
 * always keep their defaults — how much of the form should a person have to look at? Every
 * variant starts from the same defaults the real form does. Nothing here writes: creating
 * and browsing are stubs that say so. Once a variant wins, rewrite it properly in
 * `executionWorkspace.tsx` and drop this file from main.
 */
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  colorVars,
  focusVars,
  radiusVars,
  shadowVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight, Bot, Folder, FolderOpen, GitBranch, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import type { ModelOption, Ticket } from '../../preload/bridge.ts';
import { fromHome, shortenMiddle } from './executionWorkspace.ts';

export const SETUP_VARIANTS = [
  { id: 'sentence', label: 'One sentence' },
  { id: 'grid', label: 'Compact form' },
  { id: 'reveal', label: 'Button, then form' },
] as const;
export type SetupVariant = (typeof SETUP_VARIANTS)[number]['id'];

interface Choices {
  repository: string;
  baseBranch: string;
  branch: string;
  agentConfig: string;
}

interface SetupProps {
  ticket: Ticket;
  initial: Choices;
  models: ModelOption[];
  onStub: (action: string) => void;
}

export function WorkspaceSetupPrototype({
  ticket,
  initial,
}: Omit<SetupProps, 'onStub' | 'models'>) {
  const [models, setModels] = useState<ModelOption[]>([]);
  // Read once, when the prototype first draws; a prototype can take the shortcut.
  useState(() => {
    void window.kira.loadModels().then((answer) => {
      if (answer.ok) setModels(answer.value);
    });
  });
  const [variant, setVariant] = useState<SetupVariant>('sentence');
  const [note, setNote] = useState<string | null>(null);
  const props: SetupProps = {
    ticket,
    initial,
    models,
    onStub: (action) => setNote(`“${action}” is stubbed in the prototype.`),
  };

  return (
    <>
      {variant === 'sentence' && <SentenceSetup {...props} />}
      {variant === 'grid' && <GridSetup {...props} />}
      {variant === 'reveal' && <RevealSetup {...props} />}
      <div {...stylex.props(ui.switcher)} role="toolbar" aria-label="Workspace setup prototypes">
        <fieldset aria-label="Layout" {...stylex.props(ui.segments)}>
          {SETUP_VARIANTS.map((each, index) => (
            <button
              key={each.id}
              type="button"
              aria-pressed={each.id === variant}
              {...stylex.props(ui.segment, each.id === variant && ui.segmentOn)}
              onClick={() => {
                setVariant(each.id);
                setNote(null);
              }}
            >
              {String.fromCharCode(65 + index)} · {each.label}
            </button>
          ))}
        </fieldset>
        {note !== null && <span {...stylex.props(ui.note)}>{note}</span>}
      </div>
    </>
  );
}

function modelName(models: ModelOption[], id: string): string {
  return id === 'default' ? 'Default model' : (models.find((each) => each.id === id)?.name ?? id);
}

function startWords(ticket: Ticket): string {
  return ticket.band === 'ready' ? 'Create and start agent' : 'Create workspace';
}

function Fields({
  choices,
  models,
  onChange,
  onStub,
  compact = false,
}: {
  choices: Choices;
  models: ModelOption[];
  onChange: (next: Choices) => void;
  onStub: (action: string) => void;
  compact?: boolean;
}) {
  return (
    <div {...stylex.props(ui.fields, compact && ui.fieldsCompact)}>
      <div {...stylex.props(ui.full)}>
        <div {...stylex.props(ui.withButton)}>
          <div {...stylex.props(ui.grow)}>
            <TextInput
              label="Checkout"
              value={choices.repository}
              onChange={(repository) => onChange({ ...choices, repository })}
              size="sm"
            />
          </div>
          <Button
            label="Browse"
            icon={<Icon icon={FolderOpen} size="sm" />}
            size="sm"
            variant="secondary"
            onClick={() => onStub('Browse')}
          />
        </div>
      </div>
      <TextInput
        label="From branch"
        value={choices.baseBranch}
        onChange={(baseBranch) => onChange({ ...choices, baseBranch })}
        size="sm"
      />
      <TextInput
        label="Work branch"
        value={choices.branch}
        onChange={(branch) => onChange({ ...choices, branch })}
        size="sm"
      />
      <div {...stylex.props(ui.full)}>
        <Selector
          label="Agent"
          options={[
            { value: 'default', label: 'Default model' },
            ...models.map((model) => ({ value: model.id, label: model.name })),
          ]}
          value={choices.agentConfig}
          onChange={(agentConfig) => onChange({ ...choices, agentConfig })}
        />
      </div>
    </div>
  );
}

/* ── A. One sentence ────────────────────────────────────────────────────── */

function SentenceSetup({ ticket, initial, models, onStub }: SetupProps) {
  const [choices, setChoices] = useState(initial);
  const [editing, setEditing] = useState(false);

  return (
    <section {...stylex.props(ui.frame)} aria-label="Set up a workspace">
      <Text type="label" weight="medium">
        Workspace
      </Text>
      <p {...stylex.props(sentence.line)}>
        The agent works in{' '}
        <Token icon={Folder} title={choices.repository} onClick={() => setEditing(true)}>
          {fromHome(choices.repository)}
        </Token>{' '}
        on{' '}
        <Token icon={GitBranch} title={choices.branch} onClick={() => setEditing(true)}>
          {shortenMiddle(choices.branch, 28)}
        </Token>
        , branched from{' '}
        <Token icon={GitBranch} title={choices.baseBranch} onClick={() => setEditing(true)}>
          {choices.baseBranch}
        </Token>
        , using{' '}
        <Token icon={Bot} onClick={() => setEditing(true)}>
          {modelName(models, choices.agentConfig)}
        </Token>
        .
      </p>
      {editing && (
        <Fields choices={choices} models={models} onChange={setChoices} onStub={onStub} compact />
      )}
      <div {...stylex.props(ui.actions)}>
        <Button
          label={startWords(ticket)}
          size="sm"
          variant="primary"
          onClick={() => onStub(startWords(ticket))}
        />
        {!editing && (
          <Button
            label="Change"
            icon={<Icon icon={Pencil} size="sm" />}
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
          />
        )}
      </div>
    </section>
  );
}

function Token({
  icon,
  title,
  onClick,
  children,
}: {
  icon: typeof Folder;
  title?: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button type="button" title={title} {...stylex.props(sentence.token)} onClick={onClick}>
      <Icon icon={icon} size="xsm" />
      {children}
    </button>
  );
}

/* ── B. Compact form ────────────────────────────────────────────────────── */

function GridSetup({ ticket, initial, models, onStub }: SetupProps) {
  const [choices, setChoices] = useState(initial);

  return (
    <section {...stylex.props(ui.frame, grid.card)} aria-label="Set up a workspace">
      <div {...stylex.props(grid.head)}>
        <Text type="label" weight="medium">
          Set up a workspace
        </Text>
        <span {...stylex.props(grid.route)}>
          <span {...stylex.props(ui.mono)}>{choices.baseBranch}</span>
          <Icon icon={ArrowRight} size="xsm" />
          <span {...stylex.props(ui.mono)}>{shortenMiddle(choices.branch, 24)}</span>
        </span>
      </div>
      <Fields choices={choices} models={models} onChange={setChoices} onStub={onStub} compact />
      <div {...stylex.props(ui.actions, grid.foot)}>
        <Text type="supporting" color="secondary">
          {ticket.band === 'ready'
            ? 'The agent starts as soon as the workspace is made.'
            : 'The agent waits until this ticket is ready.'}
        </Text>
        <Button
          label={startWords(ticket)}
          size="sm"
          variant="primary"
          onClick={() => onStub(startWords(ticket))}
        />
      </div>
    </section>
  );
}

/* ── C. Button, then form ───────────────────────────────────────────────── */

function RevealSetup({ ticket, initial, models, onStub }: SetupProps) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState(initial);

  if (!open) {
    return (
      <section {...stylex.props(ui.frame, reveal.empty)} aria-label="Set up a workspace">
        <span {...stylex.props(reveal.icon)}>
          <Icon icon={Folder} size="md" />
        </span>
        <span {...stylex.props(reveal.copy)}>
          <Text type="label" weight="medium">
            No workspace yet
          </Text>
          <Text type="supporting" color="secondary">
            A workspace is the checkout and branch this ticket&apos;s agent works in.
          </Text>
        </span>
        <Button
          label="Set up workspace"
          icon={<Icon icon={Plus} size="sm" />}
          size="sm"
          variant="secondary"
          onClick={() => setOpen(true)}
        />
      </section>
    );
  }

  return (
    <section {...stylex.props(ui.frame)} aria-label="Set up a workspace">
      <Text type="label" weight="medium">
        Set up a workspace
      </Text>
      <Fields choices={choices} models={models} onChange={setChoices} onStub={onStub} compact />
      <div {...stylex.props(ui.actions)}>
        <Button
          label={startWords(ticket)}
          size="sm"
          variant="primary"
          onClick={() => onStub(startWords(ticket))}
        />
        <Button label="Cancel" size="sm" variant="ghost" onClick={() => setOpen(false)} />
      </div>
    </section>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const ui = stylex.create({
  frame: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    minWidth: 0,
  },
  fields: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: spacingVars['--spacing-3'],
    maxWidth: 640,
  },
  fieldsCompact: { columnGap: spacingVars['--spacing-3'], rowGap: spacingVars['--spacing-2'] },
  full: { gridColumn: '1 / -1' },
  withButton: { display: 'flex', alignItems: 'flex-end', gap: spacingVars['--spacing-2'] },
  grow: { flex: 1, minWidth: 0 },
  actions: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'] },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    whiteSpace: 'nowrap',
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
    padding: spacingVars['--spacing-1'],
    paddingInline: spacingVars['--spacing-2'],
    borderRadius: 999,
    backgroundColor: colorVars['--color-background-inverted'],
    color: colorVars['--color-background-surface'],
    boxShadow: shadowVars['--shadow-high'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  segments: {
    display: 'inline-flex',
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
  note: { paddingInline: spacingVars['--spacing-2'], opacity: 0.8, whiteSpace: 'nowrap' },
});

const sentence = stylex.create({
  line: {
    margin: 0,
    maxWidth: '62ch',
    fontSize: textSizeVars['--font-size-base'],
    lineHeight: 2,
    color: colorVars['--color-text-secondary'],
  },
  token: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 24,
    paddingInline: 7,
    verticalAlign: 'middle',
    borderWidth: 0,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: {
      default: colorVars['--color-neutral'],
      ':hover': colorVars['--color-overlay-pressed'],
    },
    color: colorVars['--color-text-primary'],
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
  },
});

const grid = stylex.create({
  card: {
    maxWidth: 680,
    padding: spacingVars['--spacing-4'],
    borderRadius: 10,
    backgroundColor: colorVars['--color-background-muted'],
  },
  head: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-2'],
  },
  route: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    color: colorVars['--color-text-secondary'],
  },
  foot: { justifyContent: 'space-between', flexWrap: 'wrap' },
});

const reveal = stylex.create({
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    maxWidth: 680,
    padding: spacingVars['--spacing-4'],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colorVars['--color-border-emphasized'],
    borderRadius: 10,
  },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    flexShrink: 0,
    borderRadius: 8,
    color: colorVars['--color-icon-secondary'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  copy: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
});
