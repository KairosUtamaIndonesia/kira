import { AppInspector } from "./AppInspector";
import { AppSidebar } from "./AppSidebar";
import { AppStatusBar } from "./AppStatusBar";
import { AppWorkspace } from "./AppWorkspace";

function AppShell() {
  return (
    <div className="grid h-dvh grid-rows-[minmax(0,1fr)_1.75rem] overflow-hidden bg-background text-foreground">
      <div className="grid min-h-0 grid-cols-[16rem_minmax(0,1fr)_18rem] border-b border-border">
        <AppSidebar />
        <AppWorkspace />
        <AppInspector />
      </div>
      <AppStatusBar />
    </div>
  );
}

export { AppShell };
