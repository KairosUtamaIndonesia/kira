import { AppWindowControls } from "./AppWindowControls";
import { useTitleBarDrag } from "./useTitleBarDrag";

function AppInspector() {
  const { handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      <div
        role="toolbar"
        aria-label="Inspector title bar"
        tabIndex={-1}
        className="flex h-11 shrink-0 items-center justify-between border-b border-sidebar-border bg-sidebar pl-3 text-sidebar-foreground select-none"
        onMouseDown={(event) => {
          void handleTitleBarMouseDown(event);
        }}
      >
        <span className="text-xs font-semibold tracking-wide text-sidebar-foreground/70 uppercase">
          Inspector
        </span>
        <AppWindowControls />
        {titleBarError === undefined ? undefined : (
          <output className="sr-only">{titleBarError}</output>
        )}
      </div>
      <div className="flex min-h-0 flex-1 scrollbar-sleek flex-col gap-3 overflow-auto p-3">
        <div className="rounded-xl border border-border p-3 text-sm text-muted-foreground">
          Contextual details and actions for the active workspace panel.
        </div>
      </div>
    </aside>
  );
}

export { AppInspector };
