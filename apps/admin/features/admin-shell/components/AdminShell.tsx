import type { ReactNode } from "react";

import { AdminHeader } from "./AdminHeader";
import { AdminSidebar } from "./AdminSidebar";

type AdminShellProperties = {
  children: ReactNode;
};

function AdminShell({ children }: AdminShellProperties) {
  return (
    <div className="grid min-h-svh bg-background text-foreground lg:grid-cols-[18rem_minmax(0,1fr)]">
      <AdminSidebar />
      <div className="flex min-w-0 flex-col">
        <AdminHeader />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export { AdminShell };
