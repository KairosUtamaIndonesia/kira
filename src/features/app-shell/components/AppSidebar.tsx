import { useTitleBarDrag } from "./useTitleBarDrag";

const navigationItems = ["Workspace", "Agents", "Files", "Runs"] as const;

function AppSidebar() {
  const { handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();

  return (
    <aside className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div
        role="toolbar"
        aria-label="Sidebar title bar"
        tabIndex={-1}
        className="flex h-11 shrink-0 items-center border-b border-sidebar-border px-3 select-none"
        onMouseDown={(event) => {
          void handleTitleBarMouseDown(event);
        }}
      >
        <span className="text-sm font-semibold tracking-tight">Kira</span>
        {titleBarError === undefined ? undefined : (
          <output className="sr-only">{titleBarError}</output>
        )}
      </div>
      <div className="flex min-h-0 flex-1 scrollbar-sleek flex-col gap-3 overflow-auto p-3">
        <div className="text-xs font-semibold tracking-wide text-sidebar-foreground/70 uppercase">
          Navigate
        </div>
        <nav className="flex flex-col gap-1" aria-label="Primary">
          {navigationItems.map((item) => (
            <button
              key={item}
              type="button"
              className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
            >
              {item}
            </button>
          ))}
        </nav>
      </div>
    </aside>
  );
}

export { AppSidebar };
