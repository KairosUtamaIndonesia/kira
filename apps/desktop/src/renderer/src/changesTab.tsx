/**
 * The Changes view: the chat's own checkout, read beside the conversation.
 *
 * It lists what git reports changed as one file list, stages a file or a hunk,
 * commits what is staged, reverts a file, switches branch, reads history and
 * syncs with the remote. A file opens in a review — its diff given the whole
 * pane, stepped through file by file — because a diff does not fit beside a list
 * in a pane this narrow. Every write goes to the main process, where one queue
 * per checkout keeps them from interleaving with the tree's status reads.
 *
 * The view is the chat's: it reads the folder the chat is filed under, and a
 * chat with no workspace or a folder that is not a checkout says so in a
 * sentence rather than showing an empty list.
 */
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';
import { borderVars, colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowDown, ArrowUp, Ellipsis, GitBranch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChangedPath, CommitSummary, Result, WorkspaceGitStatus } from '../../preload/bridge';
import { ChangesList, HistoryList } from './changesList';
import {
  type ChangedFile,
  changedFiles,
  committingCount,
  totalsOf,
  watchedFoldersOf,
} from './changesModel';
import { parts } from './changesParts';
import { ReviewScreen, type ReviewPatches } from './changesReview';
import type { DiffStyle } from './diffView';

export function ChangesTab({
  chatId,
  visits,
  showing,
  onChanged,
}: {
  chatId: string;
  /** How many times the view has been shown, so showing it again reads again. */
  visits: number;
  /** Whether the view is on screen: the folder is watched only then. */
  showing: boolean;
  /** A write landed: the file tree's changed marks are read again too. */
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<WorkspaceGitStatus | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [changes, setChanges] = useState(0);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [loadedPatches, setLoadedPatches] = useState<(ReviewPatches & { path: string }) | null>(
    null,
  );
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('unified');
  const [wrap, setWrap] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<'changes' | 'history'>('changes');
  const [branches, setBranches] = useState<{ branches: string[]; current: string | null } | null>(
    null,
  );
  const [history, setHistory] = useState<CommitSummary[] | null>(null);
  const [historyTrouble, setHistoryTrouble] = useState<string | null>(null);
  const [openCommit, setOpenCommit] = useState<string | null>(null);
  const [loadedFiles, setLoadedFiles] = useState<{ hash: string; files: ChangedPath[] } | null>(
    null,
  );
  const reading = useRef(0);
  const patchReading = useRef(0);

  const files = status === null ? [] : changedFiles(status);
  const reviewed = reviewing === null ? undefined : files.find((file) => file.path === reviewing);
  const reviewedState = reviewed?.state ?? null;

  /** Re-read the checkout and tell the tree to follow. */
  function mutated(): void {
    setTick((count) => count + 1);
    onChanged();
  }

  async function run(work: () => Promise<Result<unknown>>): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    const answer = await work();
    setBusy(false);
    if (!answer.ok) {
      setMessage(answer.error);
      return false;
    }

    return true;
  }

  useEffect(() => {
    if (visits === 0) return;
    const mine = (reading.current += 1);
    void window.kira.workspaceGitStatus(chatId).then((answer) => {
      if (mine !== reading.current) return;
      if (answer.ok) {
        setStatus(answer.value);
        setTrouble(null);
      } else {
        setStatus(null);
        setTrouble(answer.error);
      }
    });
  }, [chatId, visits, tick, changes]);

  useEffect(() => {
    if (visits === 0) return;
    void window.kira.workspaceGitBranches(chatId).then((answer) => {
      if (answer.ok) setBranches(answer.value);
    });
  }, [chatId, visits, tick]);

  /*
   * A file with changes in the index is read from the index, and one with changes in
   * the working tree is read from the tree; a partly staged file is both. Reading
   * again when the file's state changes keeps a staged hunk from lingering as unstaged.
   */
  useEffect(() => {
    if (reviewing === null || reviewedState === null) return;
    const path = reviewing;
    const mine = (patchReading.current += 1);
    const none: Result<string | null> = { ok: true, value: null };
    void Promise.all([
      reviewedState === 'unstaged' ? none : window.kira.workspaceGitPatch(chatId, path, true),
      reviewedState === 'staged' ? none : window.kira.workspaceGitPatch(chatId, path, false),
    ]).then(([staged, unstaged]) => {
      if (mine !== patchReading.current) return;
      setLoadedPatches({
        path,
        staged: staged.ok ? staged.value : null,
        unstaged: unstaged.ok ? unstaged.value : null,
        trouble: !staged.ok ? staged.error : !unstaged.ok ? unstaged.error : null,
      });
    });
  }, [chatId, reviewing, reviewedState, tick, changes]);

  useEffect(() => {
    if (view !== 'history' || visits === 0) return;
    void window.kira.workspaceGitLog(chatId, 50).then((answer) => {
      if (answer.ok) {
        setHistory(answer.value);
        setHistoryTrouble(null);
      } else {
        setHistory(null);
        setHistoryTrouble(answer.error);
      }
    });
  }, [chatId, view, visits, tick]);

  useEffect(() => {
    if (openCommit === null) return;
    const hash = openCommit;
    void window.kira.workspaceCommitFiles(chatId, hash).then((answer) => {
      setLoadedFiles({ hash, files: answer.ok ? answer.value : [] });
    });
  }, [chatId, openCommit]);

  /*
   * Watched only while it is on screen. A change says "read again"; nothing about
   * which file changed is carried, because a wrong diff is worse than a read.
   *
   * The levels watched are the root and each changed file's own folder: `fs.watch`
   * is not recursive, so watching only the root would miss an edit inside a
   * subfolder. The key is those levels joined, so a watcher-triggered re-read
   * whose paths are unchanged does not restart the watch.
   */
  const watchedKey = watchedFoldersOf(status).join('\u0000');
  useEffect(() => {
    if (!showing) return;

    void window.kira.watchWorkspace(chatId, watchedKey === '' ? [''] : watchedKey.split('\u0000'));
    const stopWatching = window.kira.onWorkspaceChanged(() => {
      setChanges((count) => count + 1);
    });

    return () => {
      stopWatching();
      void window.kira.unwatchWorkspace();
    };
  }, [chatId, showing, watchedKey]);

  async function stage(paths: string[]): Promise<boolean> {
    if (!(await run(() => window.kira.stageWorkspacePaths(chatId, paths)))) return false;
    mutated();

    return true;
  }

  async function unstage(paths: string[]): Promise<void> {
    if (await run(() => window.kira.unstageWorkspacePaths(chatId, paths))) mutated();
  }

  function toggle(file: ChangedFile): void {
    if (file.state === 'staged') void unstage([file.path]);
    else void stage([file.path]);
  }

  /** Stage the open file, then open the one after it, or go back to the list from the last. */
  async function stageAndNext(file: ChangedFile): Promise<void> {
    const next = files[files.findIndex((each) => each.path === file.path) + 1];
    if (!(await stage([file.path]))) return;
    setReviewing(next?.path ?? null);
  }

  async function revert(file: ChangedFile): Promise<void> {
    const next = files[files.findIndex((each) => each.path === file.path) + 1];
    if (await run(() => window.kira.revertWorkspacePath(chatId, file.path))) {
      setReviewing(next?.path ?? null);
      setMessage('Reverted.');
      mutated();
    }
  }

  async function applyHunk(patch: string, reverse: boolean): Promise<void> {
    if (await run(() => window.kira.applyWorkspaceHunk(chatId, patch, reverse))) {
      setMessage(reverse ? 'Unstaged the hunk.' : 'Staged the hunk.');
      mutated();
    }
  }

  async function commit(): Promise<void> {
    if (await run(() => window.kira.commitWorkspace(chatId, commitMessage))) {
      setCommitMessage('');
      setReviewing(null);
      setMessage('Committed.');
      mutated();
    }
  }

  async function switchTo(branch: string): Promise<void> {
    if (await run(() => window.kira.checkoutWorkspaceBranch(chatId, branch))) {
      setReviewing(null);
      setMessage(`On ${branch}.`);
      mutated();
    }
  }

  async function sync(action: 'fetch' | 'pull' | 'push'): Promise<void> {
    if (await run(() => window.kira.syncWorkspaceRemote(chatId, action))) {
      setMessage(`${action[0]!.toUpperCase()}${action.slice(1)} done.`);
      mutated();
    }
  }

  function move(by: number): void {
    if (reviewed === undefined) return;
    const next = files[files.indexOf(reviewed) + by];
    if (next !== undefined) setReviewing(next.path);
  }

  /*
   * The keys read the latest handlers without re-listening on every render. They
   * are the review's alone, and never fire while a field has focus.
   */
  const keys = useRef({ move, stage: () => {} });
  useEffect(() => {
    keys.current = {
      move,
      stage: () => {
        if (reviewed !== undefined && reviewed.state !== 'staged' && !busy) {
          void stageAndNext(reviewed);
        }
      },
    };
  });
  const isReviewing = reviewed !== undefined;
  useEffect(() => {
    if (!isReviewing || !showing) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')
      ) {
        return;
      }
      if (event.key === 'j') keys.current.move(1);
      else if (event.key === 'k') keys.current.move(-1);
      else if (event.key === 's') keys.current.stage();
    };
    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [isReviewing, showing]);

  if (trouble !== null) {
    return (
      <VStack gap={2}>
        <Text type="supporting" color="secondary">
          {trouble}
        </Text>
        <div>
          <Button
            label="Try again"
            size="sm"
            variant="secondary"
            onClick={() => setTick((count) => count + 1)}
          />
        </div>
      </VStack>
    );
  }

  if (status === null) return null;

  if (reviewed !== undefined) {
    const position = files.indexOf(reviewed);
    const heldPatches = loadedPatches?.path === reviewed.path ? loadedPatches : null;

    return (
      <div {...stylex.props(styles.tab)}>
        {message !== null && (
          <Text type="supporting" color="secondary">
            {message}
          </Text>
        )}
        <ReviewScreen
          key={reviewed.path}
          file={reviewed}
          position={position}
          total={files.length}
          patches={heldPatches}
          isBusy={busy}
          diffStyle={diffStyle}
          wrap={wrap}
          isLast={position === files.length - 1}
          onBack={() => setReviewing(null)}
          onMove={move}
          onHunk={(patch, reverse) => void applyHunk(patch, reverse)}
          onStage={() => void stageAndNext(reviewed)}
          onUnstage={() => void unstage([reviewed.path])}
          onRevert={() => void revert(reviewed)}
          onDiffStyle={setDiffStyle}
          onWrap={setWrap}
        />
      </div>
    );
  }

  const totals = totalsOf(files);
  const committing = committingCount(files);
  const allStaged = files.length > 0 && files.every((file) => file.state === 'staged');

  return (
    <div {...stylex.props(styles.tab)}>
      <div {...stylex.props(styles.top)}>
        <div {...stylex.props(styles.branch)}>
          {branches !== null && branches.branches.length > 0 ? (
            <Selector
              label="Branch"
              isLabelHidden
              width="100%"
              options={branches.branches.map((branch) => ({ value: branch, label: branch }))}
              value={branches.current ?? undefined}
              onChange={(branch) => void switchTo(branch)}
              isDisabled={busy}
              variant="ghost"
              size="sm"
              hasSearch
              searchPlaceholder="Search branches…"
              startIcon={GitBranch}
            />
          ) : (
            <Text type="label">{status.branch ?? 'detached'}</Text>
          )}
        </div>
        <div {...stylex.props(styles.topEnd)}>
          {(status.behind ?? 0) > 0 && (
            <Button
              label={String(status.behind)}
              tooltip={`Pull ${status.behind} commits`}
              size="sm"
              variant="ghost"
              icon={<Icon icon={ArrowDown} size="sm" />}
              isDisabled={busy}
              onClick={() => void sync('pull')}
            />
          )}
          {status.ahead !== 0 && (
            <Button
              label={status.ahead === null ? 'Push' : String(status.ahead)}
              tooltip={status.ahead === null ? 'Push this branch' : `Push ${status.ahead} commits`}
              size="sm"
              variant="ghost"
              icon={<Icon icon={ArrowUp} size="sm" />}
              isDisabled={busy}
              onClick={() => void sync('push')}
            />
          )}
          <DropdownMenu
            button={{
              label: 'More',
              size: 'sm',
              variant: 'ghost',
              isIconOnly: true,
              icon: <Icon icon={Ellipsis} size="sm" />,
            }}
            items={[
              { label: 'Fetch', isDisabled: busy, onClick: () => void sync('fetch') },
              { label: 'Pull', isDisabled: busy, onClick: () => void sync('pull') },
              { type: 'divider' },
              {
                label: 'Stage all',
                isDisabled: busy || files.length === 0 || allStaged,
                onClick: () =>
                  void stage(
                    files.filter((file) => file.state !== 'staged').map((file) => file.path),
                  ),
              },
              {
                label: 'Unstage all',
                isDisabled: busy || committing === 0,
                onClick: () =>
                  void unstage(
                    files.filter((file) => file.state !== 'unstaged').map((file) => file.path),
                  ),
              },
            ]}
          />
        </div>
      </div>

      <SegmentedControl
        label="View"
        value={view}
        onChange={(value) => setView(value as 'changes' | 'history')}
        size="sm"
        layout="fill"
      >
        <SegmentedControlItem
          value="changes"
          label={files.length === 0 ? 'Changes' : `Changes ${files.length}`}
        />
        <SegmentedControlItem value="history" label="History" />
      </SegmentedControl>

      {view === 'history' ? (
        <HistoryList
          history={history}
          trouble={historyTrouble}
          openCommit={openCommit}
          openFiles={loadedFiles?.hash === openCommit ? loadedFiles.files : null}
          onToggle={(hash) => setOpenCommit((held) => (held === hash ? null : hash))}
        />
      ) : files.length === 0 ? (
        <Text type="supporting" color={message === null ? 'secondary' : 'primary'}>
          {message ?? 'Nothing has changed in this checkout.'}
        </Text>
      ) : (
        <>
          <div {...stylex.props(styles.summaryRow)}>
            <span {...stylex.props(styles.summary)}>
              <Text type="supporting" color="secondary">
                {files.length === 1 ? '1 file' : `${files.length} files`}
              </Text>
              {(totals.added > 0 || totals.removed > 0) && (
                <span {...stylex.props(parts.mono)}>
                  <span {...stylex.props(parts.added)}>+{totals.added}</span>{' '}
                  <span {...stylex.props(parts.removed)}>−{totals.removed}</span>
                </span>
              )}
            </span>
            <Button
              label="Review"
              size="sm"
              variant="secondary"
              onClick={() => setReviewing(files[0]!.path)}
            />
          </div>
          <ChangesList files={files} isBusy={busy} onOpen={setReviewing} onToggle={toggle} />
        </>
      )}

      <div {...stylex.props(styles.grow)} />
      {view === 'changes' && files.length > 0 && (
        <div {...stylex.props(styles.foot)}>
          {message !== null && (
            <Text type="supporting" color="secondary">
              {message}
            </Text>
          )}
          <TextArea
            label="Commit message"
            isLabelHidden
            placeholder="Commit message"
            rows={3}
            value={commitMessage}
            onChange={setCommitMessage}
          />
          <div {...stylex.props(styles.commitRow)}>
            <Text type="supporting" color="secondary">
              {committing} of {files.length} staged
            </Text>
            <Button
              label="Commit"
              size="sm"
              variant="primary"
              isDisabled={busy || committing === 0 || commitMessage.trim() === ''}
              onClick={() => void commit()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const styles = stylex.create({
  tab: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    minHeight: '100%',
  },
  top: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
  branch: { flex: 1, minWidth: 0 },
  topEnd: { display: 'flex', alignItems: 'center', flexShrink: 0, gap: spacingVars['--spacing-1'] },
  summaryRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
  summary: { display: 'flex', alignItems: 'baseline', gap: spacingVars['--spacing-3'] },
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
  commitRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
});
