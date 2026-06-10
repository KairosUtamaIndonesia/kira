import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { Building2, Circle, LayoutDashboard, LogOut } from "lucide-react";
import { useState } from "react";

import type { ConsoleUserMenu } from "@/features/console-shell/data/consoleUser";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth/client";

import { useConsoleBreadcrumbs, type ConsoleBreadcrumbItem } from "./ConsoleBreadcrumbs";

const topLevelBreadcrumbs: Record<string, ConsoleBreadcrumbItem[]> = {
  "/dashboard": [{ label: "Dashboard" }],
  "/organizations": [{ label: "Organizations" }],
  "/users": [{ label: "Users" }],
  "/settings": [{ label: "Settings" }],
};

function getDefaultBreadcrumbs(pathname: string) {
  const exactMatch = topLevelBreadcrumbs[pathname];

  if (exactMatch !== undefined) {
    return exactMatch;
  }

  if (pathname.startsWith("/organizations/")) {
    return [{ label: "Organizations", href: "/organizations" }, { label: "Organization" }];
  }

  return [{ label: "Dashboard", href: "/dashboard" }];
}

type ConsoleHeaderProperties = {
  userMenu?: ConsoleUserMenu;
};

function ConsoleHeader({ userMenu }: ConsoleHeaderProperties) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { items } = useConsoleBreadcrumbs();
  const breadcrumbs = items !== undefined ? items : getDefaultBreadcrumbs(pathname);

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <SidebarTrigger />
          <Link to="/dashboard" className="font-semibold tracking-tight lg:hidden">
            Kira Platform
          </Link>
          <Breadcrumb className="hidden min-w-0 md:block">
            <BreadcrumbList>
              {breadcrumbs.map((item, index) => {
                const isLast = index === breadcrumbs.length - 1;

                return (
                  <BreadcrumbItem key={item.href ?? item.label}>
                    {index > 0 && <BreadcrumbSeparator />}
                    {isLast || item.href === undefined ? (
                      <BreadcrumbPage>{item.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link to={item.href} />}>{item.label}</BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
            <Circle aria-hidden="true" className="size-2 fill-current" />
            Local
          </span>
          {userMenu !== undefined ? (
            <ConsoleUserMenuDropdown userMenu={userMenu} />
          ) : (
            <OrgAdminUserMenuDropdown />
          )}
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Shared sign-out item
// ---------------------------------------------------------------------------

function SignOutItem() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  return (
    <DropdownMenuItem
      disabled={isSigningOut}
      onClick={async () => {
        setIsSigningOut(true);
        await authClient.signOut();
        await router.invalidate();
        await router.navigate({ to: "/sign-in", replace: true });
      }}
    >
      <LogOut className="size-4" />
      {isSigningOut ? "Signing out…" : "Sign out"}
    </DropdownMenuItem>
  );
}

// ---------------------------------------------------------------------------
// Console user menu (platform admin context — has loader data)
// ---------------------------------------------------------------------------

function ConsoleUserMenuDropdown({ userMenu }: { userMenu: ConsoleUserMenu }) {
  const initials = deriveInitials(userMenu.user.name);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" aria-label="Open user menu" className="gap-2" />}
      >
        <UserAvatar initials={initials} />
        <span className="hidden max-w-32 truncate text-sm sm:block">{userMenu.user.name}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
            <span className="font-semibold">{userMenu.user.name}</span>
            <span className="text-xs font-normal text-muted-foreground">{userMenu.user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>

        {userMenu.adminOrgs.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Switch to org
              </DropdownMenuLabel>
              {userMenu.adminOrgs.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  render={<Link to="/org/$organizationId" params={{ organizationId: org.id }} />}
                >
                  <Building2 className="size-4" />
                  {org.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : undefined}

        <DropdownMenuSeparator />
        <SignOutItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Org admin user menu (org-scoped context — uses client session)
// ---------------------------------------------------------------------------

function OrgAdminUserMenuDropdown() {
  const { data: session } = authClient.useSession();
  const name = session !== null && session !== undefined ? session.user.name : "";
  const email = session !== null && session !== undefined ? session.user.email : "";
  const isPlatformAdmin =
    session !== null && session !== undefined && session.user.role === "admin";
  const initials = deriveInitials(name);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" aria-label="Open user menu" className="gap-2" />}
      >
        <UserAvatar initials={initials} />
        <span className="hidden max-w-32 truncate text-sm sm:block">{name}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {name.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
              <span className="font-semibold">{name}</span>
              <span className="text-xs font-normal text-muted-foreground">{email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
        ) : undefined}

        {isPlatformAdmin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/dashboard" />}>
              <LayoutDashboard className="size-4" />
              Back to console
            </DropdownMenuItem>
          </>
        ) : undefined}

        <DropdownMenuSeparator />
        <SignOutItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function deriveInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function UserAvatar({ initials }: { initials: string }) {
  return (
    <span
      aria-hidden
      className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    >
      {initials}
    </span>
  );
}

export { ConsoleHeader };
