import { Link, useLocation, useParams } from "@tanstack/react-router";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

import { orgAdminNavigation } from "../navigation";

function OrgAdminSidebar() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { organizationId } = useParams({ strict: false });

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/dashboard" />}>
              <span className="font-semibold tracking-tight">Kira</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {orgAdminNavigation.map((item) => {
                const Icon = item.icon;
                const resolvedPath =
                  organizationId !== undefined
                    ? item.to.replace("$organizationId", organizationId)
                    : item.to;
                const isActive =
                  pathname === resolvedPath || pathname.startsWith(`${resolvedPath}/`);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      render={
                        <Link to={item.to} params={{ organizationId: organizationId ?? "" }} />
                      }
                      isActive={isActive}
                      size="lg"
                      tooltip={item.label}
                    >
                      <Icon aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block font-medium">{item.label}</span>
                        <span className="block truncate text-xs text-sidebar-foreground/70">
                          {item.description}
                        </span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

export { OrgAdminSidebar };
