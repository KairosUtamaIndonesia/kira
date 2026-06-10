import type { ReactNode } from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

import { ConsoleBreadcrumbProvider } from "./ConsoleBreadcrumbs";
import { ConsoleHeader } from "./ConsoleHeader";
import { ConsoleSidebar } from "./ConsoleSidebar";

type ConsoleShellProperties = {
  children: ReactNode;
};

function ConsoleShell({ children }: ConsoleShellProperties) {
  return (
    <TooltipProvider>
      <ConsoleBreadcrumbProvider>
        <SidebarProvider>
          <ConsoleSidebar />
          <SidebarInset>
            <ConsoleHeader />
            <main className="flex-1 p-4 md:p-6">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </ConsoleBreadcrumbProvider>
    </TooltipProvider>
  );
}

export { ConsoleShell };
