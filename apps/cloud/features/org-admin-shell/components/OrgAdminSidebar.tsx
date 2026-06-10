import { Link, useLocation } from "@tanstack/react-router";
import { Building2, ChevronsUpDown, LayoutDashboard } from "lucide-react";

import type {
  OrgAdminLayoutData,
  OrgAdminLayoutOrg,
} from "@/features/org-admin-shell/data/orgAdminLayout";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

import { orgAdminNavigation } from "../navigation";

type OrgAdminSidebarProperties = {
  layoutData: OrgAdminLayoutData;
};

function OrgAdminSidebar({ layoutData }: OrgAdminSidebarProperties) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { org, adminOrgs } = layoutData;

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {adminOrgs.length > 1 ? (
              <OrgSwitcher currentOrg={org} adminOrgs={adminOrgs} />
            ) : (
              <SidebarMenuButton
                size="lg"
                render={<Link to="/org/$organizationId" params={{ organizationId: org.id }} />}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent">
                  <Building2 aria-hidden className="size-4" />
                </div>
                <span className="min-w-0 truncate font-semibold">{org.name}</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {orgAdminNavigation.map((item) => {
                const Icon = item.icon;
                const resolvedPath = item.to.replace("$organizationId", org.id);
                // Overview is the index route — exact match only to avoid
                // highlighting on every child route.
                const isActive =
                  item.to === "/org/$organizationId"
                    ? pathname === resolvedPath
                    : pathname === resolvedPath || pathname.startsWith(`${resolvedPath}/`);

                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      render={<Link to={item.to} params={{ organizationId: org.id }} />}
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

      {layoutData.isPlatformAdmin ? (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link to="/organizations" />} tooltip="Admin console">
                <LayoutDashboard aria-hidden className="size-4" />
                <span className="font-medium">Admin console</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      ) : undefined}

      <SidebarRail />
    </Sidebar>
  );
}

// ---------------------------------------------------------------------------
// OrgSwitcher — shown when the user owns/admins more than one org
// ---------------------------------------------------------------------------

type OrgSwitcherProperties = {
  currentOrg: OrgAdminLayoutOrg;
  adminOrgs: OrgAdminLayoutOrg[];
};

function OrgSwitcher({ currentOrg, adminOrgs }: OrgSwitcherProperties) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton size="lg" aria-label="Switch organization" />}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent">
          <Building2 aria-hidden className="size-4" />
        </div>
        <span className="min-w-0 truncate font-semibold">{currentOrg.name}</span>
        <ChevronsUpDown
          aria-hidden
          className="ml-auto size-4 shrink-0 text-sidebar-foreground/50"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent side="bottom" align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch organization</DropdownMenuLabel>
          {adminOrgs.map((org) => (
            <DropdownMenuItem
              key={org.id}
              render={<Link to="/org/$organizationId" params={{ organizationId: org.id }} />}
            >
              <div className="flex size-5 shrink-0 items-center justify-center rounded bg-muted">
                <Building2 aria-hidden className="size-3" />
              </div>
              <span className="truncate">{org.name}</span>
              {org.id === currentOrg.id ? (
                <span className="ml-auto text-xs text-muted-foreground">Current</span>
              ) : undefined}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Platform</DropdownMenuLabel>
          <DropdownMenuItem render={<Link to="/dashboard" />}>
            <div className="flex size-5 shrink-0 items-center justify-center rounded bg-muted">
              <Building2 aria-hidden className="size-3" />
            </div>
            Back to console
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { OrgAdminSidebar };
