import {
  Check,
  FilePlus2,
  FileSymlink,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { GitStagingArea, GitStatusEntry } from "../types";

import {
  commitSourceControlChanges,
  discardSourceControlPath,
  discardSourceControlPaths,
  stageSourceControlPath,
  stageSourceControlPaths,
  unstageSourceControlPath,
  unstageSourceControlPaths,
} from "../api/sourceControlApi";
import { useSourceControlStatus } from "../hooks/useSourceControlStatus";

type SourceControlInspectorProps = {
  folderPath: string | undefined;
  onOpenDiff: (entry: GitStatusEntry) => Promise<void>;
};

type PendingDiscard =
  | { kind: "entry"; entry: GitStatusEntry }
  | { kind: "area"; area: GitStagingArea; entries: GitStatusEntry[] };

const sectionLabels: Record<GitStagingArea, string> = {
  staged: "Staged Changes",
  unstaged: "Changes",
  untracked: "Untracked",
};

const sectionOrder: GitStagingArea[] = ["staged", "unstaged", "untracked"];

function SourceControlInspector({ folderPath, onOpenDiff }: SourceControlInspectorProps) {
  const { state, refresh } = useSourceControlStatus(folderPath);
  const [filterQuery, setFilterQuery] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [mutationError, setMutationError] = useState<string>();
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard>();
  const [isMutating, setIsMutating] = useState(false);

  const normalizedFilter = filterQuery.trim().toLowerCase();
  const repository =
    state.status === "ready" && state.result.kind === "gitRepository" ? state.result : undefined;
  const grouped = useMemo(() => {
    const groups: Record<GitStagingArea, GitStatusEntry[]> = {
      staged: [],
      unstaged: [],
      untracked: [],
    };

    if (repository === undefined) {
      return groups;
    }

    for (const entry of repository.entries) {
      if (normalizedFilter.length > 0 && !entry.path.toLowerCase().includes(normalizedFilter)) {
        continue;
      }
      groups[entry.area].push(entry);
    }

    return groups;
  }, [normalizedFilter, repository]);

  if (folderPath === undefined) {
    return <EmptyState message="Select a Project to view source control details." />;
  }

  if (state.status === "idle" || state.status === "loading") {
    return <EmptyState message="Loading source control…" />;
  }

  if (state.status === "error") {
    return <EmptyState message={state.message} role="alert" />;
  }

  if (state.result.kind === "notGitRepository") {
    return <EmptyState message="Source Control is only available for Git repositories." />;
  }

  async function runMutation(operation: () => Promise<void>) {
    if (folderPath === undefined) {
      return;
    }

    setIsMutating(true);
    setMutationError(undefined);
    try {
      await operation();
      await refresh();
    } catch (error) {
      setMutationError(errorMessageFromUnknown(error));
    } finally {
      setIsMutating(false);
    }
  }

  async function handleOpenDiff(entry: GitStatusEntry) {
    setMutationError(undefined);
    try {
      await onOpenDiff(entry);
    } catch (error) {
      setMutationError(errorMessageFromUnknown(error));
    }
  }

  async function handleCommit() {
    if (folderPath === undefined) {
      return;
    }

    await runMutation(async () => {
      await commitSourceControlChanges({ folderPath, message: commitMessage });
      setCommitMessage("");
    });
  }

  function requestDiscardArea(area: GitStagingArea) {
    const entries = grouped[area];
    if (entries.length > 0) {
      setPendingDiscard({ kind: "area", area, entries });
    }
  }

  async function confirmDiscard() {
    const discard = pendingDiscard;
    setPendingDiscard(undefined);
    if (discard === undefined || folderPath === undefined) {
      return;
    }

    await runMutation(async () => {
      if (discard.kind === "entry") {
        await discardSourceControlPath({ folderPath, filePath: discard.entry.path });
        return;
      }

      await discardSourceControlPaths({
        folderPath,
        filePaths: discard.entries.map((entry) => entry.path),
      });
    });
  }

  const stagedCount = state.result.entries.filter((entry) => entry.area === "staged").length;
  const hasEntries = state.result.entries.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-border px-3 pb-3">
        <div className="flex items-center gap-2 pt-2 text-sm">
          <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {state.result.branch ?? "Detached HEAD"}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh source control"
                  disabled={isMutating}
                  onClick={() => void refresh()}
                >
                  <RefreshCw aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        </div>
        {state.result.upstreamStatus && state.result.upstreamStatus.hasUpstream ? (
          <p className="text-xs text-muted-foreground">
            {state.result.upstreamStatus.upstreamName}: {state.result.upstreamStatus.ahead} ahead,{" "}
            {state.result.upstreamStatus.behind} behind
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No upstream configured.</p>
        )}
        {state.result.conflictOperation !== "unknown" ? (
          <div className="rounded-lg border border-border bg-muted/50 p-2 text-xs text-muted-foreground">
            A {state.result.conflictOperation} operation is in progress.
          </div>
        ) : undefined}
      </div>

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <Input
          value={filterQuery}
          onChange={(event) => setFilterQuery(event.target.value)}
          placeholder="Filter files…"
          className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
        />
      </div>

      {mutationError === undefined ? undefined : (
        <div role="alert" className="border-b border-border px-3 py-2 text-xs text-destructive">
          {mutationError}
        </div>
      )}

      <div className="min-h-0 flex-1 scrollbar-sleek overflow-auto py-1">
        {!hasEntries && normalizedFilter.length === 0 ? (
          <EmptyState message="No source control changes." />
        ) : undefined}
        {hasEntries && normalizedFilter.length > 0 && allGroupsEmpty(grouped) ? (
          <EmptyState message={`No changed files match "${filterQuery}".`} />
        ) : undefined}
        {sectionOrder.map((area) => (
          <SourceControlSection
            key={area}
            area={area}
            entries={grouped[area]}
            isMutating={isMutating}
            folderPath={folderPath}
            onMutation={(operation) => void runMutation(operation)}
            onDiscardEntry={(entry) => setPendingDiscard({ kind: "entry", entry })}
            onDiscardArea={() => requestDiscardArea(area)}
            onOpenDiff={(entry) => void handleOpenDiff(entry)}
          />
        ))}
      </div>

      <div className="space-y-2 border-t border-border p-3">
        <textarea
          aria-label="Commit message"
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="Commit message"
          className="min-h-20 w-full resize-none rounded-lg border border-input bg-input px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button
          type="button"
          className="w-full"
          disabled={isMutating || stagedCount === 0 || commitMessage.trim().length === 0}
          onClick={() => void handleCommit()}
        >
          <Check aria-hidden="true" />
          Commit {stagedCount > 0 ? `${stagedCount} staged` : ""}
        </Button>
      </div>

      <AlertDialog
        open={pendingDiscard !== undefined}
        onOpenChange={(open) => !open && setPendingDiscard(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>{discardDescription(pendingDiscard)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isMutating}
              onClick={() => void confirmDiscard()}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type SourceControlSectionProps = {
  area: GitStagingArea;
  entries: GitStatusEntry[];
  folderPath: string;
  isMutating: boolean;
  onMutation: (operation: () => Promise<void>) => void;
  onDiscardEntry: (entry: GitStatusEntry) => void;
  onDiscardArea: () => void;
  onOpenDiff: (entry: GitStatusEntry) => void;
};

function SourceControlSection({
  area,
  entries,
  folderPath,
  isMutating,
  onMutation,
  onDiscardEntry,
  onDiscardArea,
  onOpenDiff,
}: SourceControlSectionProps) {
  if (entries.length === 0) {
    return <></>;
  }

  return (
    <section className="py-1">
      <div className="group/section flex items-center gap-2 px-3 py-1.5">
        <h3 className="min-w-0 flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {sectionLabels[area]} ({entries.length})
        </h3>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100">
          {area !== "staged" ? (
            <ActionButton
              label="Stage all"
              icon={Plus}
              disabled={isMutating}
              onClick={() =>
                onMutation(() =>
                  stageSourceControlPaths({
                    folderPath,
                    filePaths: entries.map((entry) => entry.path),
                  }),
                )
              }
            />
          ) : (
            <ActionButton
              label="Unstage all"
              icon={Minus}
              disabled={isMutating}
              onClick={() =>
                onMutation(() =>
                  unstageSourceControlPaths({
                    folderPath,
                    filePaths: entries.map((entry) => entry.path),
                  }),
                )
              }
            />
          )}
          {area === "staged" ? undefined : (
            <ActionButton
              label={area === "untracked" ? "Delete all untracked" : "Discard all"}
              icon={area === "untracked" ? Trash : RotateCcw}
              disabled={isMutating}
              onClick={onDiscardArea}
            />
          )}
        </div>
      </div>
      <div>
        {entries.map((entry) => (
          <SourceControlFileRow
            key={`${entry.area}:${entry.path}`}
            entry={entry}
            folderPath={folderPath}
            isMutating={isMutating}
            onMutation={onMutation}
            onDiscard={() => onDiscardEntry(entry)}
            onOpenDiff={() => onOpenDiff(entry)}
          />
        ))}
      </div>
    </section>
  );
}

type SourceControlFileRowProps = {
  entry: GitStatusEntry;
  folderPath: string;
  isMutating: boolean;
  onMutation: (operation: () => Promise<void>) => void;
  onDiscard: () => void;
  onOpenDiff: () => void;
};

function SourceControlFileRow({
  entry,
  folderPath,
  isMutating,
  onMutation,
  onDiscard,
  onOpenDiff,
}: SourceControlFileRowProps) {
  const StatusIcon = statusIcon(entry);

  return (
    <div className="group/row relative focus-within:bg-accent hover:bg-accent">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm focus-visible:outline-none"
        onClick={onOpenDiff}
      >
        <StatusIcon className={cn("size-3.5 shrink-0", statusColor(entry))} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-foreground">{entry.path}</div>
          {entry.oldPath ? (
            <div className="truncate text-xs text-muted-foreground">from {entry.oldPath}</div>
          ) : undefined}
        </div>
        {typeof entry.added === "number" || typeof entry.removed === "number" ? (
          <div className="flex shrink-0 items-center gap-1 font-mono text-[11px]">
            {typeof entry.added === "number" ? (
              <span style={{ color: "var(--git-decoration-added)" }}>+{entry.added}</span>
            ) : undefined}
            {typeof entry.removed === "number" ? (
              <span style={{ color: "var(--git-decoration-deleted)" }}>-{entry.removed}</span>
            ) : undefined}
          </div>
        ) : undefined}
      </button>
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center gap-1 bg-muted px-4 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        {entry.area === "staged" ? (
          <ActionButton
            label="Unstage"
            icon={Minus}
            disabled={isMutating}
            onClick={() =>
              onMutation(() => unstageSourceControlPath({ folderPath, filePath: entry.path }))
            }
          />
        ) : (
          <ActionButton
            label="Stage"
            icon={Plus}
            disabled={isMutating}
            onClick={() =>
              onMutation(() => stageSourceControlPath({ folderPath, filePath: entry.path }))
            }
          />
        )}
        {entry.area !== "staged" ? (
          <ActionButton
            label={entry.area === "untracked" ? "Delete untracked" : "Discard"}
            icon={entry.area === "untracked" ? Trash : RotateCcw}
            disabled={isMutating}
            onClick={onDiscard}
          />
        ) : undefined}
      </div>
    </div>
  );
}

type ActionButtonProps = {
  label: string;
  icon: typeof Plus;
  disabled?: boolean;
  onClick: () => void;
};

function ActionButton({ label, icon: Icon, disabled = false, onClick }: ActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="plain"
            size="icon-sm"
            className="pointer-events-auto"
            aria-label={label}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <Icon aria-hidden="true" />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function EmptyState({ message, role }: { message: string; role?: "alert" }) {
  return (
    <div role={role} className="p-3 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function allGroupsEmpty(groups: Record<GitStagingArea, GitStatusEntry[]>) {
  return sectionOrder.every((area) => groups[area].length === 0);
}

function statusIcon(entry: GitStatusEntry) {
  if (entry.status === "renamed" || entry.status === "copied") {
    return FileSymlink;
  }

  if (entry.status === "added" || entry.status === "untracked") {
    return FilePlus2;
  }

  if (entry.status === "deleted") {
    return Trash;
  }

  return GitBranch;
}

function statusColor(entry: GitStatusEntry) {
  if (entry.status === "added") {
    return "text-[color:var(--git-decoration-added)]";
  }

  if (entry.status === "untracked") {
    return "text-[color:var(--git-decoration-untracked)]";
  }

  if (entry.status === "deleted") {
    return "text-[color:var(--git-decoration-deleted)]";
  }

  if (entry.status === "renamed") {
    return "text-[color:var(--git-decoration-renamed)]";
  }

  if (entry.status === "copied") {
    return "text-[color:var(--git-decoration-copied)]";
  }

  return "text-[color:var(--git-decoration-modified)]";
}

function discardDescription(discard: PendingDiscard | undefined) {
  if (discard === undefined) {
    return "This will permanently discard selected working tree changes.";
  }

  if (discard.kind === "entry") {
    return `This will permanently discard changes for ${discard.entry.path}.`;
  }

  const label = sectionLabels[discard.area].toLowerCase();
  return `This will permanently discard ${discard.entries.length} ${label} item(s).`;
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Source control operation failed.";
}

export { SourceControlInspector };
