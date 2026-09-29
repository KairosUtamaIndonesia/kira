/**
 * Asking where a chat should live, in a dialog, when it has nowhere to write what Kira
 * proposed — or when a person moves a chat into a project on their own.
 *
 * The person chooses a folder from a ruled list: the folders already in a project, each
 * tagged with its project, and a last row that starts a new project in a folder they pick.
 * Nothing is chosen for them. Moving repoints the chat, so it works in that folder from
 * then on, and the words it holds come with it.
 *
 * Leaving is always allowed and always changes nothing: Cancel, Escape and the close button
 * all end up in `onCancel`, and only a move in flight holds them back. The one thing a
 * dialog that is left can leave behind is a folder picked for a new project, which is
 * remembered as a workspace the way any opened folder is and sits in the sidebar until it
 * is removed.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  focusVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { Folder, FolderPlus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Proposal, ProjectSummary, WorkspaceSummary } from '../../preload/bridge.ts';
import { FlushDialogHeader } from './dialogHeader.tsx';
import { fromHome } from './executionWorkspace.ts';
import { placesOf } from './moveToProject.ts';
import { suggestPrefix } from './workRows.ts';
import { copy } from './workCopy.ts';

/** The choice that is not a folder: start a project somewhere new. */
const NEW = '__new__';

interface Props {
  /** What is being approved, or null when the chat is only being moved. */
  what: Proposal['kind'] | null;
  chatId: string;
  workspaces: WorkspaceSummary[];
  /** The person left without moving the chat. Nothing has changed. */
  onCancel: () => void;
  /** The chat is filed under the folder they chose. */
  onMoved: () => void;
}

/**
 * Run `effect` once, when the dialog first draws: the projects are the server's, and reading
 * them is not caused by anything the person did. The escape hatch from the no-useEffect
 * rule, made explicit (.agents/skills/no-use-effect/SKILL.md).
 */
function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

export function MoveToProject({ what, chatId, workspaces, onCancel, onMoved }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  // A new project: the folder chosen for it, and what it is called.
  const [folder, setFolder] = useState<WorkspaceSummary | null>(null);
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  // The folder once its project has been made, so a retry after a refused move does not ask
  // the server for the same project twice.
  const [joined, setJoined] = useState<WorkspaceSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const read = (): void => {
    setTrouble(null);
    void window.kira.joinableProjects().then((answer) => {
      if (answer.ok) setProjects(answer.value);
      else setTrouble(answer.error);
    });
  };
  useMountEffect(read);

  const places = placesOf(workspaces, projects ?? []);
  const picked = places.find((each) => each.workspace.id === pick);
  const fresh = pick === NEW;
  const target = picked
    ? fromHome(picked.workspace.folder)
    : fresh && folder
      ? fromHome(folder.folder)
      : null;
  const canMove =
    picked !== undefined ||
    (fresh && folder !== null && name.trim() !== '' && prefix.trim() !== '');

  const leave = (): void => {
    if (!busy) onCancel();
  };

  const chooseFolder = async (): Promise<void> => {
    const answer = await window.kira.addWorkspace();
    if (!answer.ok) {
      setRefusal(answer.error);
      return;
    }

    // The picker was closed without choosing: nothing was chosen and nothing changes.
    if (answer.value === null) return;

    if (answer.value.projectId !== null) {
      setRefusal(copy.filing.folderInProject(answer.value.name));
      return;
    }

    setRefusal(null);
    setFolder(answer.value);
    if (name === '') setName(answer.value.name);
    if (prefix === '') setPrefix(suggestPrefix(answer.value.name));
  };

  const move = async (): Promise<void> => {
    if (busy || !canMove) return;
    setBusy(true);
    setRefusal(null);

    try {
      let into = picked?.workspace ?? joined;
      if (into === null && folder !== null) {
        const made = await window.kira.joinWorkspace(folder.id, {
          kind: 'new',
          name: name.trim(),
          prefix: prefix.trim(),
        });
        if (!made.ok) {
          setRefusal(made.error);
          return;
        }

        into = made.value;
        setJoined(made.value);
      }
      if (into === null) return;

      const filed = await window.kira.fileChat(chatId, into.id);
      if (!filed.ok) {
        setRefusal(filed.error);
        return;
      }

      onMoved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen onOpenChange={(next) => !next && leave()} purpose="form" width={560}>
      <FlushDialogHeader
        title={what === null ? copy.filing.moveTitle : copy.filing.title(copy.filing.these[what])}
        subtitle={what === null ? copy.filing.moveSubtitle : copy.filing.subtitle}
        onOpenChange={(next) => !next && leave()}
      />
      <div {...stylex.props(ui.body)}>
        {trouble !== null && (
          <Banner
            status="error"
            title={copy.home.loadFailed}
            description={trouble}
            endContent={
              <Button label={copy.states.tryAgain} size="sm" variant="secondary" onClick={read} />
            }
          />
        )}
        {projects === null && trouble === null ? (
          <div aria-busy="true" aria-label={copy.join.loading} {...stylex.props(ui.waiting)}>
            <Skeleton width="100%" height={40} />
            <Skeleton width="100%" height={40} index={1} />
          </div>
        ) : (
          <>
            {places.length === 0 && (
              <Text type="supporting" color="secondary">
                {copy.filing.noneYet}
              </Text>
            )}
            <div role="radiogroup" aria-label={copy.filing.group} {...stylex.props(ui.ledger)}>
              {places.map((each) => (
                <Option
                  key={each.workspace.id}
                  checked={pick === each.workspace.id}
                  isDisabled={busy}
                  onSelect={() => setPick(each.workspace.id)}
                  icon={Folder}
                  title={each.workspace.name}
                  note={fromHome(each.workspace.folder)}
                  aside={
                    each.project === undefined ? undefined : (
                      <>
                        <span {...stylex.props(ui.mono)}>{each.project.prefix}</span>
                        <span>{each.project.name}</span>
                      </>
                    )
                  }
                />
              ))}
              <Option
                checked={fresh}
                isDisabled={busy}
                onSelect={() => setPick(NEW)}
                icon={FolderPlus}
                title={copy.filing.newProject}
                note={copy.filing.newProjectNote}
              />
            </div>
            {fresh && (
              <div {...stylex.props(ui.fields)}>
                <div {...stylex.props(ui.folderLine)}>
                  <Icon icon={Folder} size="sm" color="secondary" />
                  <span
                    {...stylex.props(ui.mono, ui.clip, folder === null && ui.dim)}
                    title={folder?.folder}
                  >
                    {folder === null ? copy.filing.noFolder : fromHome(folder.folder)}
                  </span>
                  <Button
                    label={folder === null ? copy.filing.chooseFolder : copy.filing.changeFolder}
                    size="sm"
                    variant="secondary"
                    isDisabled={busy || joined !== null}
                    onClick={() => void chooseFolder()}
                  />
                </div>
                <div {...stylex.props(ui.pair)}>
                  <TextInput
                    label={copy.join.name}
                    value={name}
                    onChange={setName}
                    isDisabled={busy || joined !== null}
                    size="sm"
                  />
                  <TextInput
                    label={copy.join.prefix}
                    value={prefix}
                    onChange={(next) => setPrefix(next.toUpperCase())}
                    isDisabled={busy || joined !== null}
                    size="sm"
                  />
                </div>
                <Text type="supporting" color="secondary">
                  {copy.filing.prefixHelp}
                </Text>
              </div>
            )}
          </>
        )}
        {refusal !== null && (
          <Banner status="error" title={copy.filing.refusedTitle} description={refusal} />
        )}
      </div>
      <div {...stylex.props(ui.foot)}>
        <Text type="supporting" color="secondary" maxLines={2}>
          {target === null ? copy.filing.chooseToContinue : copy.filing.willWork(target)}
        </Text>
        <span {...stylex.props(ui.footButtons)}>
          <Button
            label={copy.actions.cancel}
            size="sm"
            variant="ghost"
            isDisabled={busy}
            onClick={leave}
          />
          <Button
            label={
              busy
                ? copy.filing.moving
                : what === null
                  ? copy.filing.move
                  : copy.filing.moveAndApprove
            }
            size="sm"
            variant="primary"
            isDisabled={busy || !canMove}
            onClick={() => void move()}
          />
        </span>
      </div>
    </Dialog>
  );
}

/** One place a chat could go: a radio the whole row selects. */
function Option({
  checked,
  isDisabled,
  onSelect,
  icon,
  title,
  note,
  aside,
}: {
  checked: boolean;
  isDisabled: boolean;
  onSelect: () => void;
  icon: LucideIcon;
  title: string;
  note: string;
  aside?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <label {...stylex.props(ui.option, checked && ui.optionOn, focused && ui.optionFocus)}>
      <input
        type="radio"
        name="where"
        checked={checked}
        disabled={isDisabled}
        onChange={onSelect}
        onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
        onBlur={() => setFocused(false)}
        {...stylex.props(ui.radio)}
      />
      <span {...stylex.props(ui.dot, checked && ui.dotOn)} aria-hidden />
      <Icon icon={icon} size="sm" color="secondary" />
      <span {...stylex.props(ui.optionText)}>
        <Text type="label" weight="medium" maxLines={1}>
          {title}
        </Text>
        <span {...stylex.props(ui.mono, ui.dim, ui.clip)} title={note}>
          {note}
        </span>
      </span>
      {aside !== undefined && <span {...stylex.props(ui.aside)}>{aside}</span>}
    </label>
  );
}

const ui = stylex.create({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    paddingBlock: spacingVars['--spacing-2'],
  },
  waiting: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  foot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-3'],
    paddingBlockStart: spacingVars['--spacing-4'],
  },
  footButtons: { display: 'flex', gap: spacingVars['--spacing-2'], marginInlineStart: 'auto' },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  dim: { color: colorVars['--color-text-secondary'] },
  clip: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  fields: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: spacingVars['--spacing-3'],
    alignItems: 'start',
  },
  folderLine: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minHeight: 32,
    minWidth: 0,
  },
  ledger: { display: 'flex', flexDirection: 'column' },
  option: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    minHeight: 52,
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-3'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    cursor: 'pointer',
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-background-muted'] },
  },
  optionOn: { backgroundColor: colorVars['--color-background-muted'] },
  optionFocus: {
    outlineWidth: focusVars['--focus-outline-width'],
    outlineStyle: focusVars['--focus-outline-style'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: -2,
  },
  radio: { position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 },
  dot: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    flexShrink: 0,
    boxSizing: 'border-box',
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border-emphasized'],
  },
  dotOn: {
    borderColor: colorVars['--color-accent'],
    backgroundColor: colorVars['--color-accent'],
    boxShadow: `inset 0 0 0 4px ${colorVars['--color-background-muted']}`,
  },
  optionText: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  aside: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-2'],
    flexShrink: 0,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
});
