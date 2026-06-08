import type { ReactNode } from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AdminBreadcrumbProvider } from "./AdminBreadcrumbs";
import { AdminHeader } from "./AdminHeader";
import { AdminSidebar } from "./AdminSidebar";

type AdminShellProperties = {
  children: ReactNode;
};

function AdminShell({ children }: AdminShellProperties) {
  return (
    <TooltipProvider>
      <AdminBreadcrumbProvider>
        <SidebarProvider>
          <AdminSidebar />
          <SidebarInset>
            <AdminHeader />
            <main className="flex-1 p-4 md:p-6">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </AdminBreadcrumbProvider>
    </TooltipProvider>
  );
}

export { AdminShell };
