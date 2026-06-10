import type { ReactNode } from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConsoleBreadcrumbProvider } from "@/features/console-shell/components/ConsoleBreadcrumbs";
import { ConsoleHeader } from "@/features/console-shell/components/ConsoleHeader";

import { OrgAdminSidebar } from "./OrgAdminSidebar";

type OrgAdminShellProperties = { children: ReactNode };

function OrgAdminShell({ children }: OrgAdminShellProperties) {
  return (
    <TooltipProvider>
      <ConsoleBreadcrumbProvider>
        <SidebarProvider>
          <OrgAdminSidebar />
          <SidebarInset>
            <ConsoleHeader />
            <main className="flex-1 p-4 md:p-6">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </ConsoleBreadcrumbProvider>
    </TooltipProvider>
  );
}

export { OrgAdminShell };
