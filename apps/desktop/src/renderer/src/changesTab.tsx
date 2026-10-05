/**
 * The Changes view: the chat's own checkout, read beside the conversation.
 *
 * It lists what git reports changed — grouped staged, unstaged and untracked —
 * draws one file's diff, stages a file or a hunk, commits what is staged, reverts
 * a file, switches branch, reads history and syncs with the remote. Every write
 * goes to the main process, where one queue per checkout keeps them from
 * interleaving with the tree's status reads.
 *
 * The view is the chat's: it reads the folder the chat is filed under, and a
 * chat with no workspace or a folder that is not a checkout says so in a
 * sentence rather than showing an empty list.
 */
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { GitBranch, Plus, RotateCcw, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChangedPath, CommitSummary, Result, WorkspaceGitStatus } from '../../preload/bridge';
import {
  type ChangeGroup,
  type ChangeRow,
  canRevert,
  changeRows,
  hunksOf,
  hunkPatch,
  type PatchHunks,
  rowKey,
  stagedCount,
  statusWord,
  watchedFoldersOf,
} from './changesModel';
import { DiffPatch, type DiffStyle } from './diffView';

const GROUPS: { key: ChangeGroup; label: string }[] = [
  { key: 'staged', label: 'Staged' },
  { key: 'unstaged', label: 'Changes' },
  { key: 'untracked', label: 'Untracked' },
];

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
  const [selected, setSelected] = useState<ChangeRow | null>(null);
  const [loadedPatch, setLoadedPatch] = useState<{
    key: string;
    patch: string | null;
    trouble: string | null;
  } | null>(null);
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

  useEffect(() => {
    if (selected === null) return;
    const key = rowKey(selected);
    const mine = (patchReading.current += 1);
    void window.kira
      .workspaceGitPatch(chatId, selected.path, selected.group === 'staged')
      .then((answer) => {
        if (mine !== patchReading.current) return;
        setLoadedPatch({
          key,
          patch: answer.ok ? answer.value : null,
          trouble: answer.ok ? null : answer.error,
        });
      });
  }, [chatId, selected, tick, changes]);

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

  async function stage(row: ChangeRow): Promise<void> {
    if (await run(() => window.kira.stageWorkspacePaths(chatId, [row.path]))) {
      setSelected(null);
      mutated();
    }
  }

  async function unstage(row: ChangeRow): Promise<void> {
    if (await run(() => window.kira.unstageWorkspacePaths(chatId, [row.path]))) {
      setSelected(null);
      mutated();
    }
  }

  async function revert(row: ChangeRow): Promise<void> {
    if (await run(() => window.kira.revertWorkspacePath(chatId, row.path))) {
      setSelected(null);
      setMessage('Reverted.');
      mutated();
    }
  }

  async function applyHunk(part: string, reverse: boolean): Promise<void> {
    if (await run(() => window.kira.applyWorkspaceHunk(chatId, part, reverse))) {
      setMessage(reverse ? 'Unstaged the hunk.' : 'Staged the hunk.');
      mutated();
    }
  }

  async function commit(): Promise<void> {
    if (await run(() => window.kira.commitWorkspace(chatId, commitMessage))) {
      setCommitMessage('');
      setMessage('Committed.');
      mutated();
    }
  }

  async function switchTo(branch: string): Promise<void> {
    if (await run(() => window.kira.checkoutWorkspaceBranch(chatId, branch))) {
      setSelected(null);
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

  const rows = changeRows(status);
  const staged = stagedCount(status);
  const heldPatch = selected !== null && loadedPatch?.key === rowKey(selected) ? loadedPatch : null;
  const patch = heldPatch?.patch ?? null;
  const patchTrouble = heldPatch?.trouble ?? null;
  const hunkParts: PatchHunks = patch === null ? { header: '', hunks: [] } : hunksOf(patch);
  const diffParts: string[] =
    patch === null
      ? []
      : hunkParts.hunks.length === 0
        ? [patch]
        : hunkParts.hunks
            .map((_, at) => hunkPatch(patch, at))
            .filter((part): part is string => part !== null);

  return (
    <div {...stylex.props(styles.tab)}>
      <HStack justify="between" align="center" gap={2}>
        <HStack gap={1} align="center">
          <Icon icon={GitBranch} size="sm" />
          {branches !== null && branches.branches.length > 0 ? (
            <select
              {...stylex.props(styles.branch)}
              aria-label="Branch"
              value={branches.current ?? ''}
              disabled={busy}
              onChange={(event) => void switchTo(event.currentTarget.value)}
            >
              {branches.current === null ? <option value="">detached</option> : null}
              {branches.branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          ) : (
            <Text type="label">{status.branch ?? 'detached'}</Text>
          )}
        </HStack>
        <HStack gap={1} align="center">
          <Button
            label="Fetch"
            size="sm"
            variant="ghost"
            isDisabled={busy}
            onClick={() => void sync('fetch')}
          />
          <Button
            label="Pull"
            size="sm"
            variant="ghost"
            isDisabled={busy}
            onClick={() => void sync('pull')}
          />
          <Button
            label="Push"
            size="sm"
            variant="ghost"
            isDisabled={busy}
            onClick={() => void sync('push')}
          />
        </HStack>
      </HStack>

      {message !== null ? (
        <Text type="supporting" color="secondary">
          {message}
        </Text>
      ) : null}

      <HStack gap={1} align="center">
        <Button
          label="Changes"
          size="sm"
          variant={view === 'changes' ? 'primary' : 'ghost'}
          onClick={() => setView('changes')}
        />
        <Button
          label="History"
          size="sm"
          variant={view === 'history' ? 'primary' : 'ghost'}
          onClick={() => setView('history')}
        />
      </HStack>

      {view === 'changes' ? (
        <VStack gap={3}>
          {rows.length === 0 ? (
            <Text type="supporting" color="secondary">
              Nothing has changed in this checkout.
            </Text>
          ) : null}
          {GROUPS.map((group) => {
            const held = rows.filter((row) => row.group === group.key);
            if (held.length === 0) return null;

            return (
              <VStack key={group.key} gap={1}>
                <Text type="supporting" weight="medium">
                  {group.label} ({held.length})
                </Text>
                {held.map((row) => (
                  <HStack key={rowKey(row)} justify="between" align="center" gap={2}>
                    <button
                      type="button"
                      {...stylex.props(
                        styles.path,
                        selected !== null && rowKey(selected) === rowKey(row) && styles.pathOn,
                      )}
                      onClick={() => setSelected(row)}
                    >
                      {row.path}
                    </button>
                    <HStack gap={1} align="center">
                      <Text type="supporting" color="secondary">
                        {statusWord(row.status)}
                      </Text>
                      {row.group === 'staged' ? (
                        <IconButton
                          label="Unstage file"
                          icon={<Icon icon={Undo2} size="sm" />}
                          isDisabled={busy}
                          onClick={() => void unstage(row)}
                        />
                      ) : (
                        <IconButton
                          label="Stage file"
                          icon={<Icon icon={Plus} size="sm" />}
                          isDisabled={busy}
                          onClick={() => void stage(row)}
                        />
                      )}
                      {canRevert(row) ? (
                        <IconButton
                          label="Revert file"
                          icon={<Icon icon={RotateCcw} size="sm" />}
                          isDisabled={busy}
                          onClick={() => void revert(row)}
                        />
                      ) : null}
                    </HStack>
                  </HStack>
                ))}
              </VStack>
            );
          })}

          <VStack gap={2}>
            <textarea
              {...stylex.props(styles.commitMessage)}
              aria-label="Commit message"
              placeholder="Commit message"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.currentTarget.value)}
            />
            <HStack justify="between" align="center">
              <Text type="supporting" color="secondary">
                {staged} staged
              </Text>
              <Button
                label="Commit"
                size="sm"
                isDisabled={busy || staged === 0 || commitMessage.trim() === ''}
                onClick={() => void commit()}
              />
            </HStack>
          </VStack>

          {selected !== null ? (
            <VStack gap={2}>
              <HStack justify="between" align="center" gap={2}>
                <Text type="label">{selected.path}</Text>
                <HStack gap={1} align="center">
                  <Button
                    label="Inline"
                    size="sm"
                    variant={diffStyle === 'unified' ? 'primary' : 'ghost'}
                    onClick={() => setDiffStyle('unified')}
                  />
                  <Button
                    label="Side by side"
                    size="sm"
                    variant={diffStyle === 'split' ? 'primary' : 'ghost'}
                    onClick={() => setDiffStyle('split')}
                  />
                  <Button
                    label={wrap ? 'Wrapped' : 'Wrap'}
                    size="sm"
                    variant={wrap ? 'primary' : 'ghost'}
                    onClick={() => setWrap((held) => !held)}
                  />
                </HStack>
              </HStack>
              {patchTrouble !== null ? (
                <Text type="supporting" color="secondary">
                  {patchTrouble}
                </Text>
              ) : null}
              {patch !== null && patch.trim() === '' ? (
                <Text type="supporting" color="secondary">
                  This file has no changes to show.
                </Text>
              ) : null}
              {diffParts.map((part, at) => (
                <div key={at} {...stylex.props(styles.hunk)}>
                  {hunkParts.hunks.length > 0 ? (
                    <Button
                      label={selected.group === 'staged' ? 'Unstage hunk' : 'Stage hunk'}
                      size="sm"
                      variant="secondary"
                      isDisabled={busy}
                      onClick={() => void applyHunk(part, selected.group === 'staged')}
                    />
                  ) : null}
                  <DiffPatch patch={part} path={selected.path} diffStyle={diffStyle} wrap={wrap} />
                </div>
              ))}
            </VStack>
          ) : null}
        </VStack>
      ) : (
        <VStack gap={2}>
          {historyTrouble !== null ? (
            <Text type="supporting" color="secondary">
              {historyTrouble}
            </Text>
          ) : null}
          {history !== null && history.length === 0 ? (
            <Text type="supporting" color="secondary">
              This branch has no commits yet.
            </Text>
          ) : null}
          {history?.map((commit) => (
            <VStack key={commit.hash} gap={1}>
              <button
                type="button"
                {...stylex.props(styles.commitRow)}
                onClick={() => setOpenCommit((held) => (held === commit.hash ? null : commit.hash))}
              >
                <Text type="label">{commit.subject}</Text>
                <Text type="supporting" color="secondary">
                  {commit.short} · {commit.author} · {commit.date}
                </Text>
              </button>
              {openCommit === commit.hash ? (
                <VStack gap={0.5}>
                  {loadedFiles?.hash === commit.hash ? (
                    loadedFiles.files.map((file) => (
                      <Text key={file.path} type="supporting" color="secondary">
                        {file.path} · {statusWord(file.status)}
                      </Text>
                    ))
                  ) : (
                    <Text type="supporting" color="secondary">
                      Reading…
                    </Text>
                  )}
                </VStack>
              ) : null}
            </VStack>
          ))}
        </VStack>
      )}
    </div>
  );
}

const styles = stylex.create({
  tab: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
  },
  branch: {
    maxWidth: 160,
    paddingInline: spacingVars['--spacing-1'],
    borderWidth: 0,
    color: colorVars['--color-text-primary'],
    backgroundColor: 'transparent',
    font: 'inherit',
  },
  path: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    borderWidth: 0,
    borderRadius: 'var(--radius-inner)',
    paddingInline: spacingVars['--spacing-1'],
    color: colorVars['--color-text-primary'],
    backgroundColor: 'transparent',
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
  },
  pathOn: {
    backgroundColor: colorVars['--color-background-muted'],
  },
  commitMessage: {
    width: '100%',
    minHeight: 64,
    resize: 'vertical',
    padding: spacingVars['--spacing-2'],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: 'var(--radius-element)',
    color: colorVars['--color-text-primary'],
    backgroundColor: colorVars['--color-background-surface'],
    font: 'inherit',
  },
  hunk: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    alignItems: 'flex-start',
  },
  commitRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    width: '100%',
    borderWidth: 0,
    padding: spacingVars['--spacing-1'],
    borderRadius: 'var(--radius-inner)',
    backgroundColor: 'transparent',
    textAlign: 'start',
    cursor: 'pointer',
  },
});
