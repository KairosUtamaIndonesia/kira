import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { MemoryEntry, MemoryStoreType } from "@/features/memory/types";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getMemoryEntries } from "@/features/memory/api/memoryApi";
import { useMemorySettings } from "@/features/memory/memorySettings";

const CHAR_LIMIT = 5_000;

const TABS: { id: MemoryStoreType; label: string }[] = [
  { id: "user", label: "User" },
  { id: "memory", label: "Notes" },
  { id: "failure", label: "Failures" },
  { id: "project", label: "Project" },
];

function MemorySettings() {
  const { entries, projectList, status, errorMessage, updateEntry, refresh } = useMemorySettings();
  const [activeTab, setActiveTab] = useState<MemoryStoreType>("user");
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [projectEntries, setProjectEntries] = useState<MemoryEntry[]>([]);
  const [projectEntriesLoading, setProjectEntriesLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | undefined>();
  const [editContent, setEditContent] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addContent, setAddContent] = useState("");

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">Loading...</div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <p className="text-destructive">{errorMessage}</p>
        <Button variant="outline" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  const activeEntries = activeTab === "project" ? projectEntries : (entries[activeTab] ?? []);
  const projectTabActive = activeTab === "project";
  const hasProjectSelected = projectTabActive && selectedProjectId !== undefined;

  function projectInput(
    action: "add" | "edit" | "delete",
    extra: { content: string; oldContent?: string },
  ) {
    const base: Parameters<typeof updateEntry>[0] = {
      storeType: activeTab,
      action,
      content: extra.content,
      ...(extra.oldContent !== undefined ? { oldContent: extra.oldContent } : {}),
    };
    if (projectTabActive && selectedProjectId !== undefined) {
      return { ...base, projectId: selectedProjectId };
    }
    return base;
  }

  async function saveEdit(entry: MemoryEntry) {
    if (editContent.length > CHAR_LIMIT) return;
    await updateEntry(projectInput("edit", { content: editContent, oldContent: entry.content }));
    if (projectTabActive && selectedProjectId !== undefined) {
      const pid = selectedProjectId;
      await loadProjectEntries(pid);
    }
    setEditingId(undefined);
    setEditContent("");
  }

  async function deleteEntry(entry: MemoryEntry) {
    if (!window.confirm("Delete this memory entry?")) return;
    await updateEntry(projectInput("delete", { content: "", oldContent: entry.content }));
    if (projectTabActive && selectedProjectId !== undefined) {
      const pid = selectedProjectId;
      await loadProjectEntries(pid);
    }
  }

  async function saveAdd() {
    if (addContent.length > CHAR_LIMIT || addContent.trim() === "") return;
    await updateEntry(projectInput("add", { content: addContent }));
    if (projectTabActive && selectedProjectId !== undefined) {
      const pid = selectedProjectId;
      await loadProjectEntries(pid);
    }
    setIsAdding(false);
    setAddContent("");
  }

  async function loadProjectEntries(projectId: string) {
    setSelectedProjectId(projectId);
    setProjectEntriesLoading(true);
    try {
      const result = await getMemoryEntries("project", projectId);
      setProjectEntries(result);
    } catch {
      setProjectEntries([]);
    } finally {
      setProjectEntriesLoading(false);
    }
  }

  function emptyStateMessage(): string {
    if (projectTabActive && !hasProjectSelected) {
      return "Select a project above to browse its memories.";
    }
    if (projectTabActive && hasProjectSelected) {
      return "No project memories yet.";
    }
    return "No entries yet. Entries are created automatically as the agent works.";
  }

  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground">
      {/* Tab bar */}
      <div className="border-b border-border">
        <div className="flex" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => {
                setActiveTab(tab.id);
                setEditingId(undefined);
                setIsAdding(false);
              }}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        {/* Project selector */}
        {projectTabActive && (
          <div className="border-t border-border px-4 py-2.5">
            <Select
              // oxlint-disable unicorn/no-null
              items={[
                { label: "Select a project...", value: null },
                ...projectList.map((p) => ({ label: p.name, value: p.id })),
              ]}
              // oxlint-enable unicorn/no-null
              value={selectedProjectId}
              onValueChange={(value) => {
                if (value) {
                  void loadProjectEntries(value);
                } else {
                  setSelectedProjectId(undefined);
                  setProjectEntries([]);
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {/* oxlint-disable-next-line unicorn/no-null */}
                  <SelectItem value={null}>Select a project...</SelectItem>
                  {projectList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Entry list */}
      <div className="grid gap-2 p-4">
        {activeEntries.length === 0 && !projectEntriesLoading && (
          <p className="py-4 text-center text-sm text-muted-foreground">{emptyStateMessage()}</p>
        )}

        {projectTabActive && projectEntriesLoading && (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
        )}

        {activeEntries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            isEditing={editingId === entry.id}
            editContent={editingId === entry.id ? editContent : ""}
            onStartEdit={() => {
              setEditingId(entry.id);
              setEditContent(entry.content);
              setIsAdding(false);
              setAddContent("");
            }}
            onEditContentChange={setEditContent}
            onSaveEdit={() => saveEdit(entry)}
            onCancelEdit={() => {
              setEditingId(undefined);
              setEditContent("");
            }}
            onDelete={() => deleteEntry(entry)}
          />
        ))}

        {/* Add entry area */}
        {isAdding && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <Textarea
              value={addContent}
              onChange={(e) => setAddContent(e.target.value)}
              placeholder="New memory entry..."
              className="mb-2 min-h-[80px]"
            />
            <div className="flex items-center justify-between">
              <span
                className={`text-xs ${
                  addContent.length > CHAR_LIMIT ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {addContent.length}/{CHAR_LIMIT}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={addContent.length > CHAR_LIMIT || addContent.trim() === ""}
                  onClick={saveAdd}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Add button */}
        {!isAdding && (!projectTabActive || hasProjectSelected) && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setIsAdding(true);
              setEditingId(undefined);
              setAddContent("");
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add entry
          </Button>
        )}
      </div>
    </section>
  );
}

// ─── Entry Card ───

type EntryCardProps = {
  entry: MemoryEntry;
  isEditing: boolean;
  editContent: string;
  onStartEdit: () => void;
  onEditContentChange: (value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
};

function EntryCard({
  entry,
  isEditing,
  editContent,
  onStartEdit,
  onEditContentChange,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: EntryCardProps) {
  return (
    <div className="group relative rounded-lg border border-border bg-muted/30 p-3">
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onStartEdit}
          aria-label="Edit entry"
          type="button"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          onClick={onDelete}
          aria-label="Delete entry"
          type="button"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {isEditing ? (
        <div>
          <Textarea
            value={editContent}
            onChange={(e) => onEditContentChange(e.target.value)}
            className="mb-2 min-h-[80px]"
          />
          <div className="flex items-center justify-between">
            <span
              className={`text-xs ${
                editContent.length > CHAR_LIMIT ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {editContent.length}/{CHAR_LIMIT}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onCancelEdit}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={editContent.length > CHAR_LIMIT || editContent.trim() === ""}
                onClick={onSaveEdit}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="pr-16 text-sm break-words whitespace-pre-wrap">{entry.content}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Created {entry.created}
            {entry.lastReferenced !== entry.created && `, last referenced ${entry.lastReferenced}`}
          </p>
        </>
      )}
    </div>
  );
}

export { MemorySettings };
