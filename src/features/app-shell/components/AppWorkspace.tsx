import { Search } from "lucide-react";

import { useTitleBarDrag } from "./useTitleBarDrag";

function AppWorkspace() {
  const { handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();

  return (
    <main className="flex min-h-0 flex-col bg-editor-surface">
      <div
        role="toolbar"
        aria-label="Workspace title bar"
        tabIndex={-1}
        className="grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background px-2 select-none"
        onMouseDown={(event) => {
          void handleTitleBarMouseDown(event);
        }}
      >
        <div className="mx-auto flex h-7 w-full max-w-xl items-center gap-2 rounded-md border border-border bg-muted px-2 text-xs text-muted-foreground">
          <Search className="size-3.5" aria-hidden="true" />
          <span className="truncate">Command, search, or ask Kira</span>
        </div>
        <div className="rounded-t-md border border-border bg-editor-surface px-3 py-1.5 text-sm">
          Welcome
        </div>
        {titleBarError === undefined ? undefined : (
          <output className="sr-only">{titleBarError}</output>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_12rem]">
        <section className="min-h-0 p-4" aria-label="Dockview workspace">
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
            Dockview tabbed and splittable workspace
          </div>
        </section>
        <section className="border-t border-border bg-background p-3" aria-label="Bottom split">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Bottom split
          </div>
        </section>
      </div>
    </main>
  );
}

export { AppWorkspace };
