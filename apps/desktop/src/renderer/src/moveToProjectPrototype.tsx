/**
 * PROTOTYPE — throwaway. Approving a spec (or its tickets) in a chat that is not in a
 * project, asked in a dialog, three ways, switchable from the strip at the top of the dialog.
 *
 * Question it answers: what is the person choosing? A: a *folder* from a ruled list (the
 * project is a tag on it). B: one dropdown, and a before → after line that says what changes.
 * C: an *intent* first (add to a project, or start one), then the project, with the folder
 * as a consequence. Nothing here writes: "Move chat and approve" only closes the dialog, and
 * the folder picker is a fixture. Reading the projects is real. Once one wins, rewrite it as
 * `moveToProject.tsx`, put its words in `workCopy.ts`, and drop this file.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
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
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, ChevronLeft, ChevronRight, Folder, FolderPlus, Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { ProjectSummary, WorkspaceSummary } from '../../preload/bridge.ts';
import { fromHome } from './executionWorkspace.ts';
import { FlushDialogHeader } from './dialogHeader.tsx';
import { suggestPrefix } from './workRows.ts';

const VARIANTS = [
  { id: 'folders', label: 'A · Folders' },
  { id: 'route', label: 'B · Route' },
  { id: 'intent', label: 'C · Intent' },
] as const;
type Variant = (typeof VARIANTS)[number]['id'];

const NEW = '__new__';
/** The folder picker is main-process only and remembers what it picks, so it is faked here. */
const PICKED_FOLDER = '~/Workspace/tomato-timer';

interface Place {
  workspace: WorkspaceSummary;
  project: ProjectSummary | undefined;
}

interface Props {
  what: 'spec' | 'tickets';
  workspaces: WorkspaceSummary[];
  onCancel: () => void;
  onMove: () => void;
}

export function MoveToProjectPrototype({ what, workspaces, onCancel, onMove }: Props) {
  const [variant, setVariant] = useState<Variant>('folders');
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const read = (): void => {
    setTrouble(null);
    void window.kira.joinableProjects().then((answer) => {
      if (answer.ok) setProjects(answer.value);
      else setTrouble(answer.error);
    });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(read, []);

  const byId = new Map((projects ?? []).map((each) => [each.id, each]));
  const places: Place[] = workspaces
    .filter((each) => each.projectId !== null)
    .map((each) => ({ workspace: each, project: byId.get(each.projectId ?? '') }));

  const step = (by: number): void => {
    const at = VARIANTS.findIndex((each) => each.id === variant);
    setVariant(VARIANTS[(at + by + VARIANTS.length) % VARIANTS.length]!.id);
  };
  const shared = { places, projects: projects ?? [], onCancel, onMove };

  return (
    <Dialog isOpen onOpenChange={(next) => !next && onCancel()} purpose="form" width={560}>
      <div {...stylex.props(ui.strip)}>
        <IconButton
          icon={<Icon icon={ChevronLeft} size="sm" />}
          label="Previous variant"
          size="sm"
          variant="ghost"
          onClick={() => step(-1)}
        />
        <Text type="supporting" color="secondary">
          Prototype · {VARIANTS.find((each) => each.id === variant)?.label}
        </Text>
        <IconButton
          icon={<Icon icon={ChevronRight} size="sm" />}
          label="Next variant"
          size="sm"
          variant="ghost"
          onClick={() => step(1)}
        />
      </div>
      <FlushDialogHeader
        title={
          what === 'spec' ? 'Where should this spec live?' : 'Where should these tickets live?'
        }
        subtitle={`A ${what === 'spec' ? 'spec' : 'ticket'} belongs to a project. This chat isn’t in one yet.`}
        onOpenChange={(next) => !next && onCancel()}
      />
      {trouble !== null && (
        <Banner
          status="error"
          title="Couldn’t load projects"
          description={trouble}
          endContent={<Button label="Try again" size="sm" variant="secondary" onClick={read} />}
        />
      )}
      {projects === null && trouble === null ? (
        <div {...stylex.props(ui.body)} aria-busy="true" aria-label="Loading projects">
          <Skeleton width="100%" height={40} />
          <Skeleton width="100%" height={40} index={1} />
        </div>
      ) : (
        <>
          {variant === 'folders' && <FoldersVariant {...shared} />}
          {variant === 'route' && <RouteVariant {...shared} />}
          {variant === 'intent' && <IntentVariant {...shared} />}
        </>
      )}
    </Dialog>
  );
}

/* ── Shared pieces ──────────────────────────────────────────────────────── */

interface VariantProps {
  places: Place[];
  projects: ProjectSummary[];
  onCancel: () => void;
  onMove: () => void;
}

function Foot({
  note,
  canMove,
  onCancel,
  onMove,
}: {
  note: ReactNode;
  canMove: boolean;
  onCancel: () => void;
  onMove: () => void;
}) {
  return (
    <div {...stylex.props(ui.foot)}>
      <Text type="supporting" color="secondary" maxLines={2}>
        {note}
      </Text>
      <span {...stylex.props(ui.footButtons)}>
        <Button label="Cancel" size="sm" variant="ghost" onClick={onCancel} />
        <Button
          label="Move chat and approve"
          size="sm"
          variant="primary"
          isDisabled={!canMove}
          onClick={onMove}
        />
      </span>
    </div>
  );
}

/** Name and prefix for a project made here, and the folder it is made in. */
function NewProject({
  folder,
  setFolder,
  name,
  setName,
  prefix,
  setPrefix,
}: {
  folder: string | null;
  setFolder: (folder: string) => void;
  name: string;
  setName: (name: string) => void;
  prefix: string;
  setPrefix: (prefix: string) => void;
}) {
  const choose = (): void => {
    setFolder(PICKED_FOLDER);
    if (name === '') setName('tomato-timer');
    if (prefix === '') setPrefix(suggestPrefix('tomato-timer'));
  };

  return (
    <div {...stylex.props(ui.fields)}>
      <div {...stylex.props(ui.folderLine)}>
        <Icon icon={Folder} size="sm" color="secondary" />
        <span {...stylex.props(ui.mono, folder === null && ui.dim)} title={folder ?? undefined}>
          {folder ?? 'No folder chosen'}
        </span>
        <Button
          label={folder === null ? 'Choose folder…' : 'Change'}
          size="sm"
          variant="secondary"
          onClick={choose}
        />
      </div>
      <div {...stylex.props(ui.pair)}>
        <TextInput label="Name" value={name} onChange={setName} size="sm" />
        <TextInput
          label="Prefix"
          value={prefix}
          onChange={(next) => setPrefix(next.toUpperCase())}
          description="Two to six letters or digits. Tickets are named with it, like POMO-1."
          size="sm"
        />
      </div>
    </div>
  );
}

function useNewProject() {
  const [folder, setFolder] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const ready = folder !== null && name.trim() !== '' && prefix.trim() !== '';

  return { folder, setFolder, name, setName, prefix, setPrefix, ready };
}

const projectName = (place: Place): string => place.project?.name ?? place.workspace.name;

/* ── A · Folders ────────────────────────────────────────────────────────── */

function FoldersVariant({ places, onCancel, onMove }: VariantProps) {
  const [pick, setPick] = useState<string>(places[0]?.workspace.id ?? NEW);
  const fresh = useNewProject();
  const picked = places.find((each) => each.workspace.id === pick);
  const folder = picked ? fromHome(picked.workspace.folder) : fresh.folder;

  return (
    <>
      <div {...stylex.props(ui.body)}>
        <div role="radiogroup" aria-label="Where this chat goes" {...stylex.props(ui.ledger)}>
          {places.map((each) => (
            <Option
              key={each.workspace.id}
              checked={pick === each.workspace.id}
              onSelect={() => setPick(each.workspace.id)}
              icon={Folder}
              title={each.workspace.name}
              note={fromHome(each.workspace.folder)}
              aside={
                <>
                  <span {...stylex.props(ui.mono)}>{each.project?.prefix ?? '—'}</span>
                  <span>{projectName(each)}</span>
                </>
              }
            />
          ))}
          <Option
            checked={pick === NEW}
            onSelect={() => setPick(NEW)}
            icon={FolderPlus}
            title="Start a new project"
            note="in a folder you choose"
          />
        </div>
        {pick === NEW && <NewProject {...fresh} />}
        {places.length === 0 && pick !== NEW && (
          <Text type="supporting" color="secondary">
            No folder is in a project yet.
          </Text>
        )}
      </div>
      <Foot
        note={
          folder === null
            ? 'Choose a folder for this chat.'
            : `Kira will work in ${folder} from now on.`
        }
        canMove={picked !== undefined || (pick === NEW && fresh.ready)}
        onCancel={onCancel}
        onMove={onMove}
      />
    </>
  );
}

function Option({
  checked,
  onSelect,
  icon,
  title,
  note,
  aside,
}: {
  checked: boolean;
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

/* ── B · Route ──────────────────────────────────────────────────────────── */

function RouteVariant({ places, onCancel, onMove }: VariantProps) {
  const [pick, setPick] = useState<string>(places[0]?.workspace.id ?? NEW);
  const fresh = useNewProject();
  const picked = places.find((each) => each.workspace.id === pick);
  const where = picked ? fromHome(picked.workspace.folder) : fresh.folder;
  const tickets = picked
    ? `${picked.project?.prefix ?? '—'} · ${projectName(picked)}`
    : fresh.name.trim() !== '' && fresh.prefix.trim() !== ''
      ? `${fresh.prefix} · ${fresh.name}`
      : null;

  return (
    <>
      <div {...stylex.props(ui.body)}>
        <Selector
          label="Project folder"
          options={[
            ...places.map((each) => ({
              value: each.workspace.id,
              label: `${projectName(each)} · ${fromHome(each.workspace.folder)}`,
            })),
            { value: NEW, label: 'Start a new project…' },
          ]}
          value={pick}
          onChange={setPick}
        />
        {pick === NEW && <NewProject {...fresh} />}
        <div {...stylex.props(ui.route)} aria-label="What this changes">
          <span {...stylex.props(ui.routeLabel)}>Chat folder</span>
          <span {...stylex.props(ui.routeValue)}>
            <span {...stylex.props(ui.pill, ui.pillBase)}>its own scratch folder</span>
            <Icon icon={ArrowRight} size="xsm" color="secondary" />
            <span {...stylex.props(ui.pill, ui.pillWork, where === null && ui.dim)}>
              {where ?? '…'}
            </span>
          </span>
          <span {...stylex.props(ui.routeLabel)}>Written to</span>
          <span {...stylex.props(ui.routeValue)}>
            <span {...stylex.props(ui.pill, ui.pillWork, tickets === null && ui.dim)}>
              {tickets ?? '…'}
            </span>
          </span>
        </div>
      </div>
      <Foot
        note={null}
        canMove={picked !== undefined || (pick === NEW && fresh.ready)}
        onCancel={onCancel}
        onMove={onMove}
      />
    </>
  );
}

/* ── C · Intent ─────────────────────────────────────────────────────────── */

function IntentVariant({ places, projects, onCancel, onMove }: VariantProps) {
  const [intent, setIntent] = useState<'existing' | 'new'>(
    projects.length > 0 ? 'existing' : 'new',
  );
  const [projectId, setProjectId] = useState<string>(
    places[0]?.project?.id ?? projects[0]?.id ?? '',
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const fresh = useNewProject();

  const folders = places.filter((each) => each.project?.id === projectId);
  const [folderId, setFolderId] = useState<string>('');
  const folder = folders.find((each) => each.workspace.id === folderId) ?? folders[0];
  const shown =
    intent === 'new' ? fresh.folder : folder ? fromHome(folder.workspace.folder) : chosen;
  const canMove = intent === 'new' ? fresh.ready : projectId !== '' && shown !== null;

  return (
    <>
      <div {...stylex.props(ui.body)}>
        <SegmentedControl
          value={intent}
          onChange={(next) => setIntent(next as 'existing' | 'new')}
          label="Add to a project, or start one"
          size="sm"
        >
          <SegmentedControlItem value="existing" label="Add to a project" />
          <SegmentedControlItem value="new" label="Start a new project" />
        </SegmentedControl>

        {intent === 'existing' ? (
          <div {...stylex.props(ui.fields)}>
            <Selector
              label="Project"
              options={projects.map((each) => ({
                value: each.id,
                label: `${each.name} · ${each.prefix}`,
              }))}
              value={projectId}
              onChange={(next) => {
                setProjectId(next);
                setFolderId('');
                setChosen(null);
              }}
            />
            {folders.length > 1 && (
              <Selector
                label="Folder"
                options={folders.map((each) => ({
                  value: each.workspace.id,
                  label: fromHome(each.workspace.folder),
                }))}
                value={folder?.workspace.id ?? ''}
                onChange={setFolderId}
              />
            )}
            {folders.length <= 1 && (
              <div {...stylex.props(ui.folderLine)}>
                <Icon icon={Folder} size="sm" color="secondary" />
                <span {...stylex.props(ui.mono, shown === null && ui.dim)}>
                  {shown ?? 'No folder on this machine works this project yet'}
                </span>
                {folder === undefined && (
                  <Button
                    label={chosen === null ? 'Choose folder…' : 'Change'}
                    size="sm"
                    variant="secondary"
                    icon={<Icon icon={Plus} size="sm" />}
                    onClick={() => setChosen(PICKED_FOLDER)}
                  />
                )}
              </div>
            )}
          </div>
        ) : (
          <NewProject {...fresh} />
        )}
      </div>
      <Foot
        note={
          shown === null
            ? 'Choose a folder for this chat.'
            : `Kira will work in ${shown} from now on.`
        }
        canMove={canMove}
        onCancel={onCancel}
        onMove={onMove}
      />
    </>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const ui = stylex.create({
  strip: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBlockEnd: spacingVars['--spacing-2'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'dashed',
    borderColor: colorVars['--color-border-emphasized'],
    borderRadius: radiusVars['--radius-element'],
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    paddingBlock: spacingVars['--spacing-2'],
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
    borderBlockEndWidth: 1,
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
  optionText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  aside: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-2'],
    flexShrink: 0,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  route: {
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 1fr)',
    alignItems: 'center',
    columnGap: spacingVars['--spacing-4'],
    rowGap: spacingVars['--spacing-2'],
    padding: spacingVars['--spacing-3'],
    borderRadius: 8,
    backgroundColor: colorVars['--color-background-muted'],
  },
  routeLabel: {
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  routeValue: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-1'],
    minWidth: 0,
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
});
