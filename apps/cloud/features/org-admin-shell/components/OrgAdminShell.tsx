import type { ReactNode } from "react";

import { useLocation } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";

import type {
  OrgAdminLayoutData,
  OrgAdminLayoutOrg,
} from "@/features/org-admin-shell/data/orgAdminLayout";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ConsoleBreadcrumbProvider,
  ConsoleBreadcrumbSetter,
} from "@/features/console-shell/components/ConsoleBreadcrumbs";
import { ConsoleHeader } from "@/features/console-shell/components/ConsoleHeader";
import { orgAdminNavigation } from "@/features/org-admin-shell/navigation";

import { OrgAdminSidebar } from "./OrgAdminSidebar";

type OrgAdminShellProperties = {
  children: ReactNode;
  layoutData: OrgAdminLayoutData;
};

function OrgAdminShell({ children, layoutData }: OrgAdminShellProperties) {
  const pathname = useLocation({ select: (l) => l.pathname });

  return (
    <TooltipProvider>
      <ConsoleBreadcrumbProvider>
        <SidebarProvider>
          <OrgAdminSidebar layoutData={layoutData} />
          <SidebarInset>
            <OrgAdminBreadcrumbSetter org={layoutData.org} />
            <ConsoleHeader />
            <main className="relative flex-1 p-4 md:p-6">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </main>
          </SidebarInset>
        </SidebarProvider>
      </ConsoleBreadcrumbProvider>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// OrgAdminBreadcrumbSetter
// Derives breadcrumbs from the current pathname and org — no per-page wiring.
// ---------------------------------------------------------------------------

function OrgAdminBreadcrumbSetter({ org }: { org: OrgAdminLayoutOrg }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const baseHref = `/org/${org.id}`;

  const items = useMemo(() => {
    if (pathname === baseHref) {
      return [{ label: org.name }];
    }

    const matched = orgAdminNavigation.find((item) => {
      const resolved = item.to.replace("$organizationId", org.id);
      return pathname === resolved || pathname.startsWith(`${resolved}/`);
    });

    return [
      { label: org.name, href: baseHref },
      { label: matched !== undefined ? matched.label : "Organization" },
    ];
  }, [pathname, org, baseHref]);

  return <ConsoleBreadcrumbSetter items={items} />;
}

export { OrgAdminShell };
