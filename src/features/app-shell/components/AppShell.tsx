import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

import { AppInspector } from "./AppInspector";
import { AppSidebar } from "./AppSidebar";
import { AppStatusBar } from "./AppStatusBar";
import { AppWorkspace } from "./AppWorkspace";
import { useDevThemeToggle } from "./useDevThemeToggle";

function AppShell() {
  useDevThemeToggle();

  return (
    <div className="grid h-dvh grid-rows-[minmax(0,1fr)_1.75rem] overflow-hidden bg-background text-foreground">
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 border-b border-border"
      >
        <ResizablePanel
          className="min-h-0"
          defaultSize="16rem"
          minSize="12rem"
          maxSize="24rem"
          groupResizeBehavior="preserve-pixel-size"
        >
          <AppSidebar />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel className="min-h-0" minSize="24rem">
          <AppWorkspace />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          className="min-h-0"
          defaultSize="18rem"
          minSize="14rem"
          maxSize="28rem"
          groupResizeBehavior="preserve-pixel-size"
        >
          <AppInspector />
        </ResizablePanel>
      </ResizablePanelGroup>
      <AppStatusBar />
    </div>
  );
}

export { AppShell };
