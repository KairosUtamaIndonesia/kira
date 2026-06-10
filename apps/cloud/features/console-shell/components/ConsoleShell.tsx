import type { ReactNode } from "react";

import type { ConsoleUserMenu } from "@/features/console-shell/data/consoleUser";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

import { ConsoleBreadcrumbProvider } from "./ConsoleBreadcrumbs";
import { ConsoleHeader } from "./ConsoleHeader";
import { ConsoleSidebar } from "./ConsoleSidebar";

type ConsoleShellProperties = {
  children: ReactNode;
  userMenu: ConsoleUserMenu;
};

function ConsoleShell({ children, userMenu }: ConsoleShellProperties) {
  return (
    <TooltipProvider>
      <ConsoleBreadcrumbProvider>
        <SidebarProvider>
          <ConsoleSidebar />
          <SidebarInset>
            <ConsoleHeader userMenu={userMenu} />
            <main className="flex-1 p-4 md:p-6">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </ConsoleBreadcrumbProvider>
    </TooltipProvider>
  );
}

export { ConsoleShell };
