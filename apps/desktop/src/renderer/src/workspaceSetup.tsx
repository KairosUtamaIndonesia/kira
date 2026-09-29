/**
 * Setting up a ticket's execution workspace: a quiet "No workspace yet" row in the
 * document, and the choices in a dialog. The checkout and base branch are pickers, since
 * their answers are known; only the new branch's name is typed, and a button inside that
 * field puts the suggested name back.
 */
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { FlushDialogHeader } from './dialogHeader.tsx';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import {
  Field,
  inputStatusBorderStyles,
  inputStatusFocusWithinStyles,
  inputWrapperStyles,
} from '@astryxdesign/core/Field';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  radiusVars,
  sizeVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight, Folder, Plus, Sparkles } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ModelOption, Ticket } from '../../preload/bridge.ts';
import { fromHome, shortenMiddle, suggestExecutionBranch } from './executionWorkspace.ts';
import { copy } from './workCopy.ts';

interface Choices {
  repository: string;
  baseBranch: string;
  branch: string;
  agentConfig: string;
}

/** What is known of the chosen checkout's branches: still asking, the list, or why not. */
type Branches =
  | { state: 'loading' }
  | { state: 'ready'; names: string[] }
  | { state: 'failed'; why: string };

const OTHER_FOLDER = '__other__';

/** Why a new branch's name would be refused, or null when git would take it. */
function branchTrouble(name: string, base: string): string | null {
  if (name.trim() === '') return copy.setup.branchTrouble.empty;
  if (/\s/.test(name)) return copy.setup.branchTrouble.spaces;
  if (/[~^:?*[\\]|\.\.|@\{|\/$|\.lock$|^-/.test(name)) {
    return copy.setup.branchTrouble.invalid;
  }
  if (name === base) return copy.setup.branchTrouble.sameAsBase;
  return null;
}

/** The row that stands where a ticket's workspace will be, until it has one. */
export function NoWorkspaceRow({ onSetUp }: { onSetUp: () => void }) {
  return (
    <section {...stylex.props(styles.empty)} aria-label={copy.setup.emptyAria}>
      <span {...stylex.props(styles.emptyIcon)}>
        <Icon icon={Folder} size="md" />
      </span>
      <span {...stylex.props(styles.emptyCopy)}>
        <Text type="label" weight="medium">
          {copy.setup.emptyTitle}
        </Text>
        <Text type="supporting" color="secondary">
          {copy.setup.emptyNote}
        </Text>
      </span>
      <Button
        label={copy.setup.button}
        icon={<Icon icon={Plus} size="sm" />}
        size="sm"
        variant="secondary"
        onClick={onSetUp}
      />
    </section>
  );
}

/** Drawn only while it is wanted, so drawing it is opening it. */
export function WorkspaceSetupDialog({
  ticket,
  repository,
  existingBranches,
  onClose,
  onCreated,
}: {
  ticket: Ticket;
  repository: string;
  existingBranches: string[];
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const suggested = suggestExecutionBranch(ticket.branch, existingBranches);
  const [choices, setChoices] = useState<Choices>({
    repository,
    baseBranch: '',
    branch: suggested,
    agentConfig: 'default',
  });
  const [checkouts, setCheckouts] = useState([repository]);
  const [branches, setBranches] = useState<Branches>({ state: 'loading' });
  const [models, setModels] = useState<ModelOption[]>([]);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const branchId = useId();

  // The checkout whose answer is wanted, so a slow answer for a folder the person has
  // already left does not overwrite the one they are looking at.
  const asked = useRef('');
  const readBranches = (folder: string): void => {
    asked.current = folder;
    setBranches({ state: 'loading' });
    void window.kira.listCheckoutBranches(folder).then((answer) => {
      if (asked.current !== folder) return;
      if (!answer.ok) {
        setBranches({ state: 'failed', why: answer.error });
        return;
      }
      const { branches: names, current } = answer.value;
      setBranches({ state: 'ready', names });
      setChoices((now) => ({
        ...now,
        baseBranch: current !== null && names.includes(current) ? current : (names[0] ?? ''),
      }));
    });
  };

  useMountEffect(() => {
    readBranches(repository);
    void window.kira.loadModels().then((answer) => {
      if (answer.ok) setModels(answer.value);
    });
  });

  const branchTroubled =
    branches.state === 'ready' ? branchTrouble(choices.branch, choices.baseBranch) : null;
  const canCreate =
    branches.state === 'ready' && choices.baseBranch !== '' && branchTroubled === null && !busy;
  const startsNow = ticket.band === 'ready';
  const actionLabel = startsNow ? copy.setup.createAndStart : copy.setup.create;

  const chooseFolder = async (): Promise<void> => {
    const answer = await window.kira.chooseCheckout();
    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }
    if (answer.value === null) return;
    const folder = answer.value;
    setTrouble(null);
    setCheckouts((now) => (now.includes(folder) ? now : [...now, folder]));
    setChoices((now) => ({ ...now, repository: folder, baseBranch: '' }));
    readBranches(folder);
  };

  const create = async (): Promise<void> => {
    setBusy(true);
    const result = await window.kira.createExecutionWorkspace(ticket.id, {
      repository: choices.repository,
      baseBranch: choices.baseBranch,
      branch: choices.branch.trim(),
      agentConfig: choices.agentConfig,
    });
    setBusy(false);
    if (!result.ok) {
      setTrouble(result.error);
      return;
    }
    await onCreated(result.value.id);
  };

  const note =
    trouble ??
    (branches.state === 'failed'
      ? branches.why
      : startsNow
        ? copy.setup.startsNow
        : copy.setup.startsLater);
  const shownTrouble = branchTroubled;

  return (
    <Dialog
      isOpen
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      purpose="form"
      width={520}
    >
      <FlushDialogHeader
        title={copy.setup.title}
        subtitle={copy.setup.subtitle(ticket.name)}
        onOpenChange={(next) => {
          if (!next && !busy) onClose();
        }}
      />
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.route)} aria-label={copy.setup.route}>
          <span {...stylex.props(styles.pill, styles.pillBase)}>{choices.baseBranch || '…'}</span>
          <span {...stylex.props(styles.arrow)}>
            <Icon icon={ArrowRight} size="xsm" />
          </span>
          <span
            title={choices.branch}
            {...stylex.props(styles.pill, styles.pillWork, shownTrouble !== null && styles.pillBad)}
          >
            {shortenMiddle(choices.branch || 'unnamed', 34)}
          </span>
          <span {...stylex.props(styles.routeWhere)} title={choices.repository}>
            {copy.setup.in(fromHome(choices.repository))}
          </span>
        </div>

        <Selector
          label={copy.setup.checkout}
          description={copy.setup.checkoutNote}
          options={[
            ...checkouts.map((each) => ({ value: each, label: fromHome(each) })),
            { value: OTHER_FOLDER, label: copy.setup.otherFolder },
          ]}
          value={choices.repository}
          isDisabled={busy}
          onChange={(value) => {
            if (value === OTHER_FOLDER) {
              void chooseFolder();
              return;
            }
            setChoices({ ...choices, repository: value, baseBranch: '' });
            setTrouble(null);
            readBranches(value);
          }}
        />

        <div {...stylex.props(styles.pair)}>
          <Selector
            label={copy.setup.fromBranch}
            description={branches.state === 'loading' ? copy.setup.readingBranches : undefined}
            options={
              branches.state === 'ready'
                ? branches.names.map((each) => ({ value: each, label: each }))
                : []
            }
            value={choices.baseBranch}
            isDisabled={busy || branches.state !== 'ready'}
            onChange={(baseBranch) => setChoices({ ...choices, baseBranch })}
          />
          <Field
            label={copy.setup.newBranch}
            description={copy.setup.newBranchNote}
            inputID={branchId}
            descriptionID={`${branchId}-description`}
            status={
              shownTrouble === null
                ? undefined
                : { type: 'error', message: shownTrouble, messageID: `${branchId}-trouble` }
            }
          >
            <div
              {...stylex.props(
                inputWrapperStyles.base,
                shownTrouble !== null && inputStatusBorderStyles.error,
                shownTrouble !== null && inputStatusFocusWithinStyles.error,
                styles.branchField,
              )}
            >
              <input
                id={branchId}
                value={choices.branch}
                spellCheck={false}
                disabled={busy}
                aria-invalid={shownTrouble !== null || undefined}
                aria-describedby={
                  shownTrouble === null
                    ? `${branchId}-description`
                    : `${branchId}-description ${branchId}-trouble`
                }
                {...stylex.props(styles.branchInput)}
                onChange={(event) => setChoices({ ...choices, branch: event.target.value })}
              />
              <IconButton
                label={copy.setup.useSuggested}
                tooltip={copy.setup.useSuggested}
                icon={<Icon icon={Sparkles} size="sm" />}
                variant="ghost"
                size="sm"
                isDisabled={busy || choices.branch === suggested}
                onClick={() => setChoices({ ...choices, branch: suggested })}
              />
            </div>
          </Field>
        </div>

        <Selector
          label={copy.setup.agent}
          options={[
            { value: 'default', label: copy.setup.defaultModel },
            ...models.map((model) => ({ value: model.id, label: model.name })),
          ]}
          value={choices.agentConfig}
          isDisabled={busy}
          onChange={(agentConfig) => setChoices({ ...choices, agentConfig })}
        />
      </div>
      <div {...stylex.props(styles.foot)}>
        <Text type="supporting" color="secondary">
          {note}
        </Text>
        <span {...stylex.props(styles.footButtons)}>
          <Button
            label={copy.setup.cancel}
            size="sm"
            variant="ghost"
            isDisabled={busy}
            onClick={onClose}
          />
          <Button
            label={busy ? copy.setup.creating : actionLabel}
            size="sm"
            variant="primary"
            isDisabled={!canCreate}
            onClick={() => void create()}
          />
        </span>
      </div>
    </Dialog>
  );
}

const styles = stylex.create({
  empty: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
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
  emptyCopy: { display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 200px', minWidth: 0 },
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
  /*
   * The name field is drawn from Astryx's own input pieces (Field and the input wrapper
   * styles TextInput is built from) so the suggest button can sit inside its border:
   * TextInput has no end slot, and InputGroup draws the button as a second box.
   */
  branchField: {
    height: sizeVars['--size-element-md'],
    paddingInlineStart: spacingVars['--spacing-3'],
    paddingInlineEnd: spacingVars['--spacing-1'],
  },
  branchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    padding: 0,
    borderWidth: 0,
    outline: 'none',
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    fontFamily: typographyVars['--font-family-body'],
    fontSize: textSizeVars['--font-size-base'],
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

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}
