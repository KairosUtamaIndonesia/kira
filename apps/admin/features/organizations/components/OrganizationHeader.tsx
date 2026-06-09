import { Link, useLocation } from "@tanstack/react-router";
import { useMemo } from "react";

import type { Organization } from "@/features/organizations/types";

import { AdminBreadcrumbSetter } from "@/features/admin-shell/components/AdminBreadcrumbs";
import { organizationNavigation } from "@/features/admin-shell/navigation";
import { cn } from "@/lib/utils";

type OrganizationHeaderProperties = {
  organization: Organization;
};

function OrganizationHeader({ organization }: OrganizationHeaderProperties) {
  const pathname = useLocation({ select: (location) => location.pathname });

  const activeTab = organizationNavigation.find(
    (item) => pathname === item.to.replace("$organizationId", organization.id),
  );

  const breadcrumbItems = useMemo(
    () => [
      { label: "Organizations", href: "/organizations" },
      { label: organization.name, href: `/organizations/${organization.id}` },
      ...(activeTab !== undefined && activeTab.to !== "/organizations/$organizationId"
        ? [{ label: activeTab.label }]
        : []),
    ],
    [activeTab, organization.id, organization.name],
  );

  return (
    <>
      <AdminBreadcrumbSetter items={breadcrumbItems} />

      <div className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">Organization</p>
          <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
          <p className="text-sm text-muted-foreground">{organization.slug}</p>
        </div>

        <nav aria-label="Organization sections" className="flex flex-wrap gap-2">
          {organizationNavigation.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.to.replace("$organizationId", organization.id);
            return (
              <Link
                key={item.to}
                to={item.to}
                params={{ organizationId: organization.id }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-4",
                    isActive ? "text-primary-foreground" : "text-muted-foreground",
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}

export { OrganizationHeader };
