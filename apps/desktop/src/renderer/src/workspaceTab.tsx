/**
 * The chat's workspace, drawn as the workbench's Workspace tab.
 *
 * This paints what `workspaceRows` decided: it asks for a folder when its row is
 * clicked and holds the answers, and it says the things a tree cannot — a chat
 * with nothing said in it yet has no workspace at all, a folder git cannot answer
 * for was shown whole and has nothing marked in it (ADR 0014), a folder with
 * nothing in it is empty, and what the dot beside a changed file means.
 *
 * Nothing here decides what may be read. The channel takes the chat and a path
 * inside its workspace and the main process resolves the rest, so a path that
 * leaves the workspace is refused there rather than guarded against here.
 */
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TreeList, type TreeListItemData } from '@astryxdesign/core/TreeList';
import { borderVars, colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { FilePlus2, FolderPlus, ListCollapse, RefreshCw, Search, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FileTypeIcon } from './fileTypeIcon';
import { type Reads, type Row, readingOf, rowsIn } from './workspaceRows';

/** The workspace itself, which is the level the pane asks for first. */
const ROOT = '';

const styles = stylex.create({
  tab: {
    display: 'flex',
    flexDirection: 'column',
  },
  /**
   * What is being shown, above what is in it: the folder's own name, and what
   * the tree cannot say for itself — that it is empty, or that nothing in it was
   * hidden. Kept out of the tree so it does not read as a row of one.
   */
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    paddingBlockEnd: spacingVars['--spacing-3'],
    marginBlockEnd: spacingVars['--spacing-2'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  actions: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-1'] },
  search: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minHeight: 34,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: 'var(--radius-element)',
    color: colorVars['--color-text-secondary'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  searchInput: {
    width: '100%',
    minWidth: 0,
    border: 0,
    outline: 0,
    color: colorVars['--color-text-primary'],
    backgroundColor: 'transparent',
    font: 'inherit',
    '::placeholder': { color: colorVars['--color-text-secondary'] },
  },
  createForm: { display: 'flex', gap: spacingVars['--spacing-2'] },
  createInput: {
    flex: 1,
    minWidth: 0,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: 'var(--radius-element)',
    color: colorVars['--color-text-primary'],
    backgroundColor: colorVars['--color-background-surface'],
  },
});

/**
 * `workspaceName` is what to call the folder: a project's own name, or null when
 * the chat works in a workspace Kira made, which is named in words because
 * its own name is a UUID.
 *
 * `visits` counts how many times the tab has been shown, and `showing` says
 * whether it is on screen now: the folder is read again every time it is shown,
 * and watched while it is on screen, so a file Kira writes reaches the tree
 * without anyone asking. Which levels are read again is decided here, because
 * this is what knows which of them the tree is holding (ADR 0016).
 */
export function WorkspaceTab({
  chatId,
  visits,
  showing,
  onOpenFile,
}: {
  chatId: string;
  /** How many times this tab has been shown, so showing it again reads again. */
  visits: number;
  /** Whether the tree is on screen: its tab, in a pane that is not put away. */
  showing: boolean;
  /** A file's row was clicked. What follows — a tab, and what is in it — is the pane's. */
  onOpenFile: (path: string) => void;
}) {
  const [read, setRead] = useState<Reads>(new Map());
  /** What the watch has said, counted: one more is one more look. */
  const [changes, setChanges] = useState(0);
  const [query, setQuery] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState('');
  const uploadInput = useRef<HTMLInputElement>(null);
  /** Which read is the current one, so a slower earlier one cannot win. */
  const reading = useRef(0);
  /**
   * The levels this pane is holding: the root, and every folder that has been
   * opened. These are the levels watched, and the levels a change reads again —
   * nothing else, which is what keeps a folder of sixty thousand files as cheap
   * to keep up with as an empty one: the tree is never walked to find out what
   * else there might be.
   */
  const held = useRef(new Set<string>([ROOT]));

  /*
   * Every level this pane is holding, read again.
   *
   * Once for the chat this was built for, again every time the tab is shown, and
   * again whenever the watch says the folder has changed. The tab above is
   * rebuilt rather than reused when the chat on screen changes, so this runs
   * again for the next chat and an answer that arrives late — after a switch, or
   * after a chat being composed has been spoken in — arrives nowhere.
   */
  useEffect(() => {
    const mine = (reading.current += 1);

    void Promise.all(
      [...held.current].map(async (folder) => {
        const result = await window.kira.listWorkspaceFolder(chatId, folder);

        // A later read has already answered: what this one found is older than
        // what is on screen, and drawing it would be going backwards.
        if (mine !== reading.current) return;

        setRead((before) => new Map(before).set(folder, readingOf(result)));
      }),
    );
  }, [chatId, visits, changes, refresh]);

  /*
   * Watched while it is on screen, and not otherwise: a folder is not watched
   * for a chat nobody is looking at (ADR 0016). The watch says nothing but
   * "look again" — a burst of it is one more look rather than one per event,
   * because the events are gathered in the main process, where they arrive.
   */
  useEffect(() => {
    if (!showing) return;

    void window.kira.watchWorkspace(chatId, [...held.current]);
    const stopWatching = window.kira.onWorkspaceChanged(() => {
      setChanges((count) => count + 1);
    });

    return () => {
      stopWatching();
      void window.kira.unwatchWorkspace();
    };
  }, [chatId, showing]);

  async function open(path: string): Promise<void> {
    held.current.add(path);
    // A level that has just been opened is a level to keep up with: it is on
    // screen from now on, so it is watched from now on.
    void window.kira.watchWorkspace(chatId, [...held.current]);

    const mine = reading.current;
    const result = await window.kira.listWorkspaceFolder(chatId, path);

    if (mine !== reading.current || !held.current.has(path)) return;
    setRead((before) => new Map(before).set(path, readingOf(result)));
  }

  async function createItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = newName.trim();
    if (!creating || !name || name === '.' || name === '..' || /[/\\]/.test(name)) return;
    const result = await window.kira.createWorkspaceItem(chatId, name, creating);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setCreating(null);
    setNewName('');
    setMessage('');
    setRefresh((n) => n + 1);
  }

  async function uploadFile(file: File | undefined): Promise<void> {
    if (!file) return;
    const result = await window.kira.uploadWorkspaceFile(
      chatId,
      file.name,
      new Uint8Array(await file.arrayBuffer()),
    );
    setMessage(result.ok ? '' : result.error);
    if (result.ok) setRefresh((n) => n + 1);
  }

  function itemOf(row: Row): TreeListItemData {
    if (row.kind === 'notice') {
      // A row that says a folder has not been read is also what reads it, so
      // opening the folder from its caret is not a dead end; a notice that names
      // no folder is only a sentence, and has nothing to click.
      const opens = row.opens;

      return opens === undefined
        ? { id: row.id, label: row.label, isDisabled: true }
        : { id: row.id, label: row.label, onClick: () => void open(opens) };
    }

    const item: TreeListItemData = {
      id: row.path,
      label: row.name,
      startContent: <FileTypeIcon name={row.name} kind={row.kind} />,
    };

    // A file's row is what opens it, the way a folder's row is what reads it, and
    // a changed file carries the dot. A folder is not marked for what changed
    // under it: the mark is about a file rather than about everything below one.
    if (row.kind === 'file') {
      return {
        ...item,
        onClick: () => onOpenFile(row.path),
        /*
         * The mark is Astryx's own dot, and its label is what carries it to
         * anyone reading by ear — the row is named with the mark in it, which is
         * also why the pane's line about the dot is enough for anyone reading by
         * eye.
         */
        endContent: row.changed ? <StatusDot variant="warning" label="Changed" /> : undefined,
      };
    }

    /*
     * A folder is a folder before it is read, and carries its children from the
     * first paint — for one nobody has read, the row that says so. Astryx decides
     * how far every row is indented from whether the tree holds an expandable row
     * anywhere, so a tree of nothing but leaves sits flush and the first folder
     * opened would shove every row sideways. A folder nobody has read has no
     * contents to open, so its row is what reads it; one that has been read keeps
     * open and closed itself from then on.
     */
    const children = row.children.map(itemOf);

    return row.unopened
      ? { ...item, children, onClick: () => void open(row.path) }
      : { ...item, children, isExpanded: true };
  }

  const root = read.get(ROOT);

  // Being read. A folder that is not known yet is not an empty one, so nothing
  // is drawn until it is.
  if (root === undefined) return null;

  if (root.kind === 'no-workspace') {
    return (
      <Text type="supporting" color="secondary">
        This chat has no workspace yet. It gets one when you say something in it.
      </Text>
    );
  }

  if (root.kind === 'failed') {
    return (
      <Text type="supporting" color="secondary">
        {root.reason}
      </Text>
    );
  }

  // A workspace with nothing in it is said in the pane's own words rather than
  // drawn as a folder with a notice under it: the tree is what is in the folder,
  // and this is about the folder itself.
  const empty = root.entries.length === 0;
  const matches = (row: Row, term: string): boolean => {
    if (row.kind === 'notice') return false;
    if (row.name.toLocaleLowerCase().includes(term)) return true;
    return row.kind === 'folder' && row.children.some((child) => matches(child, term));
  };
  const allRows = empty ? [] : rowsIn(read, ROOT);
  const term = query.trim().toLocaleLowerCase();
  const rows = term ? allRows.filter((row) => matches(row, term)) : allRows;

  return (
    <div {...stylex.props(styles.tab)}>
      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.titleRow)}>
          <Text type="supporting" weight="medium">
            Files
          </Text>
          <div {...stylex.props(styles.actions)}>
            <IconButton
              label="New file"
              icon={<Icon icon={FilePlus2} size="sm" />}
              onClick={() => {
                setCreating('file');
                setNewName('');
              }}
            />
            <IconButton
              label="New folder"
              icon={<Icon icon={FolderPlus} size="sm" />}
              onClick={() => {
                setCreating('folder');
                setNewName('');
              }}
            />
            <IconButton
              label="Upload file"
              icon={<Icon icon={Upload} size="sm" />}
              onClick={() => uploadInput.current?.click()}
            />
            <IconButton
              label="Refresh files"
              icon={<Icon icon={RefreshCw} size="sm" />}
              onClick={() => setRefresh((n) => n + 1)}
            />
            <IconButton
              label="Collapse all folders"
              icon={<Icon icon={ListCollapse} size="sm" />}
              onClick={() => {
                reading.current += 1;
                held.current = new Set([ROOT]);
                setRead(new Map([[ROOT, root]]));
                void window.kira.watchWorkspace(chatId, [ROOT]);
              }}
            />
          </div>
        </div>
        <label {...stylex.props(styles.search)}>
          <Icon icon={Search} size="sm" />
          <input
            {...stylex.props(styles.searchInput)}
            aria-label="Search files"
            placeholder="Search files..."
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        {creating ? (
          <form {...stylex.props(styles.createForm)} onSubmit={(event) => void createItem(event)}>
            <input
              {...stylex.props(styles.createInput)}
              aria-label={creating === 'file' ? 'New file name' : 'New folder name'}
              placeholder={creating === 'file' ? 'File name' : 'Folder name'}
              value={newName}
              onChange={(event) => setNewName(event.currentTarget.value)}
            />
            <IconButton
              label={`Create ${creating}`}
              type="submit"
              icon={<Icon icon={creating === 'file' ? FilePlus2 : FolderPlus} size="sm" />}
            />
          </form>
        ) : null}
        <input
          ref={uploadInput}
          type="file"
          hidden
          onChange={(event) => {
            void uploadFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        {message ? (
          <Text type="supporting" color="secondary">
            {message}
          </Text>
        ) : null}
        {empty ? (
          <Text type="supporting" color="secondary">
            This workspace is empty.
          </Text>
        ) : null}
        {/*
         * Said only when there is something to say it about: an empty folder is
         * empty, and how it was filtered is not the interesting thing about it.
         */}
        {!empty && !root.filtered ? (
          <Text type="supporting" color="secondary">
            Everything is shown, and nothing is marked: git cannot answer for this folder.
          </Text>
        ) : null}
        {/*
         * git could answer for the folder but not for what has changed in it,
         * which is the other way a tree can be unmarked without being untouched.
         */}
        {!empty && root.filtered && root.changed === null ? (
          <Text type="supporting" color="secondary">
            Nothing is marked: git cannot say what has changed here.
          </Text>
        ) : null}
        {/*
         * What the dot means, said where the dots are. The marks are git's, so
         * this is also what keeps a folder with no dots from being read as a
         * folder where nothing has happened.
         */}
        {!empty && root.filtered && root.changed !== null && root.changed.length > 0 ? (
          <Text type="supporting" color="secondary">
            A dot marks a file git reports as changed.
          </Text>
        ) : null}
      </div>

      {empty ? null : <TreeList items={rows.map(itemOf)} density="compact" />}
    </div>
  );
}
