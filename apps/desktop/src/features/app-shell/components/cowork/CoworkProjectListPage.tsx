import { ArrowLeft, FolderKanban, Loader2, Plus } from "lucide-react";

import type { Project } from "@/features/projects/types";

import { Button } from "@/components/ui/button";

import type { CoworkProjectsState } from "../../hooks/useCoworkProjects";

// ─── Types ──────────────────────────────────────────────────────────────────

type CoworkProjectListPageProps = {
  projectsState: CoworkProjectsState;
  onProjectSelect: (project: Project) => void;
  onProjectCreate: () => void;
  isCreatingProject: boolean;
  onBack: () => void;
};

// ─── Component ──────────────────────────────────────────────────────────────

function CoworkProjectListPage({
  projectsState,
  onProjectSelect,
  onProjectCreate,
  isCreatingProject,
  onBack,
}: CoworkProjectListPageProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button type="button" variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <h1 className="text-lg font-semibold">Projects</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {projectsState.status === "loading" && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 aria-hidden="true" className="mr-2 animate-spin" />
            Loading projects…
          </div>
        )}
        {projectsState.status === "error" && (
          <div className="flex items-center justify-center py-12 text-destructive">
            {projectsState.message ?? "Failed to load projects."}
          </div>
        )}
        {projectsState.status === "ready" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projectsState.projects.map(({ project, threads }) => (
              <button
                key={project.id}
                type="button"
                className="group flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                onClick={() => onProjectSelect(project)}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
                  <FolderKanban aria-hidden="true" className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{project.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {threadCountLabel(threads.length)}
                  </p>
                </div>
              </button>
            ))}
            <button
              type="button"
              disabled={isCreatingProject}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              onClick={onProjectCreate}
            >
              {isCreatingProject ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              <span className="text-sm">New project</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function threadCountLabel(count: number): string {
  if (count === 0) {
    return "No conversations";
  }
  if (count === 1) {
    return "1 conversation";
  }
  return `${count} conversations`;
}

export { CoworkProjectListPage };
