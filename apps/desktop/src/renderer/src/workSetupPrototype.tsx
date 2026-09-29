/**
 * PROTOTYPE — throwaway. Setting up a ticket's execution workspace: a quiet "No workspace
 * yet" row in the document, and the choices in a dialog it opens.
 *
 * Question it answers: does setting up read better as a dialog, with the choices that have
 * a known set of answers picked rather than typed? The checkout and the base branch are
 * pickers; only the new branch's name is typed, since it is a name nobody has made yet.
 *
 * Two things here are not the real data yet, and the dialog says so: the base-branch list
 * is a sample (the real one needs a main-process channel that lists a checkout's
 * branches), and "Choose another folder…" is a stub (the real one needs a folder picker
 * that does not also register the folder as a workspace). Creating is a stub too. Once
 * this is settled, rewrite it in `executionWorkspace.tsx` and drop this file from main.
 */
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  radiusVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight, Folder, Plus } from 'lucide-react';
import { useState } from 'react';
import type { ModelOption, Ticket } from '../../preload/bridge.ts';
import { fromHome, shortenMiddle } from './executionWorkspace.ts';

interface Choices {
  repository: string;
  baseBranch: string;
  branch: string;
  agentConfig: string;
}

/** PROTOTYPE sample: what a checkout's branch list might hold. */
const SAMPLE_BRANCHES = ['main', 'develop', 'release/0.4'];
const OTHER_FOLDER = '__other__';

/** Why a new branch's name would be refused, or null when git would take it. */
function branchTrouble(name: string, base: string): string | null {
  if (name.trim() === '') return 'Name the branch the agent will work on.';
  if (/\s/.test(name)) return 'A branch name cannot contain spaces.';
  if (/[~^:?*[\\]|\.\.|@\{|\/$|\.lock$|^-/.test(name)) {
    return 'Git will not take this name; use letters, numbers, - and /.';
  }
  if (name === base) return 'The work branch must differ from the branch it comes from.';
  return null;
}

export function WorkspaceSetupPrototype({ ticket, initial }: { ticket: Ticket; initial: Choices }) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  // Read once, when the prototype first draws; a prototype can take the shortcut.
  useState(() => {
    void window.kira.loadModels().then((answer) => {
      if (answer.ok) setModels(answer.value);
    });
  });

  const trouble = branchTrouble(choices.branch, choices.baseBranch);
  const startsNow = ticket.band === 'ready';
  const close = (): void => {
    setOpen(false);
    setNote(null);
  };

  return (
    <>
      <section {...stylex.props(styles.empty)} aria-label="Set up a workspace">
        <span {...stylex.props(styles.emptyIcon)}>
          <Icon icon={Folder} size="md" />
        </span>
        <span {...stylex.props(styles.emptyCopy)}>
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
          onClick={() => {
            setChoices(initial);
            setOpen(true);
          }}
        />
      </section>

      <Dialog
        isOpen={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        purpose="form"
        width={520}
      >
        <DialogHeader
          title="Set up a workspace"
          subtitle={`Where ${ticket.name}’s agent works.`}
          onOpenChange={(next) => (next ? setOpen(true) : close())}
        />
        <div {...stylex.props(styles.body)}>
          <div {...stylex.props(styles.route)} aria-label="The branch the agent will make">
            <span {...stylex.props(styles.pill, styles.pillBase)}>{choices.baseBranch}</span>
            <span {...stylex.props(styles.arrow)}>
              <Icon icon={ArrowRight} size="xsm" />
            </span>
            <span
              title={choices.branch}
              {...stylex.props(styles.pill, styles.pillWork, trouble !== null && styles.pillBad)}
            >
              {shortenMiddle(choices.branch || 'unnamed', 34)}
            </span>
            <span {...stylex.props(styles.routeWhere)} title={choices.repository}>
              in {fromHome(choices.repository)}
            </span>
          </div>

          <Selector
            label="Checkout"
            description="The local repository the agent works in."
            options={[
              { value: choices.repository, label: fromHome(choices.repository) },
              { value: OTHER_FOLDER, label: 'Choose another folder…' },
            ]}
            value={choices.repository}
            onChange={(value) => {
              if (value === OTHER_FOLDER) {
                setNote('“Choose another folder…” is stubbed in the prototype.');
                return;
              }
              setChoices({ ...choices, repository: value });
            }}
          />

          <div {...stylex.props(styles.pair)}>
            <Selector
              label="From branch"
              description="Sample list in the prototype."
              options={SAMPLE_BRANCHES.map((each) => ({ value: each, label: each }))}
              value={choices.baseBranch}
              onChange={(baseBranch) => setChoices({ ...choices, baseBranch })}
            />
            <TextInput
              label="New branch"
              description="Suggested from the ticket."
              value={choices.branch}
              onChange={(branch) => setChoices({ ...choices, branch })}
              status={trouble === null ? undefined : { type: 'error', message: trouble }}
              size="md"
            />
          </div>

          <Selector
            label="Agent"
            options={[
              { value: 'default', label: 'Default model' },
              ...models.map((model) => ({ value: model.id, label: model.name })),
            ]}
            value={choices.agentConfig}
            onChange={(agentConfig) => setChoices({ ...choices, agentConfig })}
          />
        </div>
        <div {...stylex.props(styles.foot)}>
          <Text type="supporting" color="secondary">
            {note ??
              (startsNow
                ? 'The agent starts as soon as the workspace is made.'
                : 'The agent waits until this ticket is ready.')}
          </Text>
          <span {...stylex.props(styles.footButtons)}>
            <Button label="Cancel" size="sm" variant="ghost" onClick={close} />
            <Button
              label={startsNow ? 'Create and start agent' : 'Create workspace'}
              size="sm"
              variant="primary"
              isDisabled={trouble !== null}
              onClick={() =>
                setNote(
                  `“${startsNow ? 'Create and start agent' : 'Create workspace'}” is stubbed in the prototype.`,
                )
              }
            />
          </span>
        </div>
      </Dialog>
    </>
  );
}

const styles = stylex.create({
  empty: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    maxWidth: 680,
    padding: spacingVars['--spacing-4'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'dashed',
    borderColor: colorVars['--color-border-emphasized'],
    borderRadius: 10,
  },
  emptyIcon: {
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
  emptyCopy: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    paddingBlock: spacingVars['--spacing-2'],
  },
  route: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-1'],
    padding: spacingVars['--spacing-3'],
    borderRadius: 8,
    backgroundColor: colorVars['--color-background-muted'],
  },
  pill: {
    height: 22,
    paddingInline: 7,
    borderRadius: radiusVars['--radius-element'],
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    lineHeight: '22px',
    whiteSpace: 'nowrap',
  },
  pillBase: {
    color: colorVars['--color-text-secondary'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  pillWork: {
    color: colorVars['--color-text-primary'],
    backgroundColor: colorVars['--color-neutral'],
  },
  pillBad: { color: colorVars['--color-error'] },
  arrow: { display: 'inline-flex', color: colorVars['--color-icon-secondary'] },
  routeWhere: {
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    whiteSpace: 'nowrap',
  },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 1.2fr)',
    gap: spacingVars['--spacing-3'],
    alignItems: 'start',
  },
  foot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-3'],
    paddingBlockStart: spacingVars['--spacing-4'],
  },
  footButtons: { display: 'flex', gap: spacingVars['--spacing-2'], marginInlineStart: 'auto' },
});
