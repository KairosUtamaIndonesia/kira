import { Plus, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { useTitleBarDrag } from "./useTitleBarDrag";

function AppSidebar() {
  const { handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();

  return (
    <SidebarProvider className="h-full min-h-0">
      <Sidebar collapsible="none" className="w-full">
        <SidebarHeader
          role="toolbar"
          aria-label="Sidebar title bar"
          tabIndex={-1}
          className="h-11 justify-center border-b border-sidebar-border px-3 py-0 select-none"
          onMouseDown={(event) => {
            void handleTitleBarMouseDown(event);
          }}
        >
          <span className="font-semibold tracking-tight">Kira</span>
          {titleBarError === undefined ? undefined : (
            <output className="sr-only">{titleBarError}</output>
          )}
        </SidebarHeader>
        <SidebarContent className="scrollbar-sleek">
          <SidebarGroup aria-label="Projects">
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarGroupAction aria-label="New Workspace">
                    <Plus aria-hidden="true" />
                  </SidebarGroupAction>
                }
              />
              <TooltipContent>New Workspace</TooltipContent>
            </Tooltip>
            <SidebarGroupContent>
              <SidebarMenu aria-label="Projects" />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Button type="button" variant="ghost" />}>
                <Settings aria-hidden="true" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  );
}

export { AppSidebar };
