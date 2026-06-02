import type { ActiveWorkspaceState } from "../types";

import { AppWindowControls } from "./AppWindowControls";
import { useTitleBarDrag } from "./useTitleBarDrag";

type AppInspectorProps = {
  activeWorkspace: ActiveWorkspaceState;
};

function AppInspector({ activeWorkspace }: AppInspectorProps) {
  const { handleTitleBarDoubleClick, handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      <div
        role="toolbar"
        aria-label="Inspector title bar"
        tabIndex={-1}
        className="flex h-11 shrink-0 items-center justify-between border-b border-sidebar-border bg-sidebar pl-3 text-sidebar-foreground select-none"
        onDoubleClick={(event) => {
          void handleTitleBarDoubleClick(event);
        }}
        onMouseDown={(event) => {
          void handleTitleBarMouseDown(event);
        }}
      >
        <span className="font-semibold tracking-wide text-sidebar-foreground/70 uppercase">
          Inspector
        </span>
        <AppWindowControls />
        {titleBarError === undefined ? undefined : (
          <output className="sr-only">{titleBarError}</output>
        )}
      </div>
      <div className="flex min-h-0 flex-1 scrollbar-sleek flex-col gap-3 overflow-auto p-3">
        {inspectorContent(activeWorkspace)}
      </div>
    </aside>
  );
}

function inspectorContent(activeWorkspace: ActiveWorkspaceState) {
  if (activeWorkspace.status === "active") {
    return (
      <section className="space-y-3 rounded-xl border border-border p-3">
        <h2 className="text-sm font-medium text-foreground">Project</h2>
        <dl className="space-y-2 text-sm">
          <InspectorField label="Name" value={activeWorkspace.project.name} />
          <InspectorField label="Folder" value={activeWorkspace.project.folderPath} mono />
          <InspectorField label="Session" value={activeWorkspace.session.name} />
          <InspectorField label="Panels" value={activeWorkspace.panels.length.toString()} />
        </dl>
      </section>
    );
  }

  if (activeWorkspace.status === "loading") {
    return (
      <div className="rounded-xl border border-border p-3 text-muted-foreground">
        Opening project…
      </div>
    );
  }

  if (activeWorkspace.status === "error") {
    return (
      <div role="alert" className="rounded-xl border border-border p-3 text-muted-foreground">
        {activeWorkspace.message}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border p-3 text-muted-foreground">
      Select a Project to view its details.
    </div>
  );
}

type InspectorFieldProps = {
  label: string;
  value: string;
  mono?: boolean;
};

function InspectorField({ label, value, mono = false }: InspectorFieldProps) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-xs break-all text-foreground" : "text-foreground"}>
        {value}
      </dd>
    </div>
  );
}

export { AppInspector };
