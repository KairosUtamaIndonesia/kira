import type { ReactNode } from "react";

import { useLocation } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";

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
  const pathname = useLocation({ select: (l) => l.pathname });

  return (
    <TooltipProvider>
      <ConsoleBreadcrumbProvider>
        <SidebarProvider>
          <ConsoleSidebar />
          <SidebarInset>
            <ConsoleHeader userMenu={userMenu} />
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

export { ConsoleShell };
