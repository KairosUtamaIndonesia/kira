import { Link, useLocation } from "@tanstack/react-router";
import { Circle } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";

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

function ConsoleHeader() {
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
          <Button variant="outline" size="sm">
            User menu
          </Button>
        </div>
      </div>
    </header>
  );
}

export { ConsoleHeader };
