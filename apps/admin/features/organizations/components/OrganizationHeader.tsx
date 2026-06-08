"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Organization } from "@/features/organizations/types";

import { organizationNavigation } from "@/features/admin-shell/navigation";
import { cn } from "@/lib/utils";

type OrganizationHeaderProperties = {
  organization: Organization;
};

function OrganizationHeader({ organization }: OrganizationHeaderProperties) {
  const pathname = usePathname();

  const activeTab = organizationNavigation.find((item) => {
    const tabHref =
      item.href.length === 0
        ? `/organizations/${organization.id}`
        : `/organizations/${organization.id}/${item.href}`;
    return pathname === tabHref;
  });

  const breadcrumbItems = [
    { label: "Organizations", href: "/organizations" },
    { label: organization.name, href: `/organizations/${organization.id}` },
    ...(activeTab !== undefined && activeTab.href.length > 0 ? [{ label: activeTab.label }] : []),
  ];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Organization</p>
        <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
        <p className="text-sm text-muted-foreground">{organization.slug}</p>
      </div>

      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1 text-sm text-muted-foreground"
      >
        {breadcrumbItems.map((item, index) => {
          const isLast = index === breadcrumbItems.length - 1;
          return (
            <span key={item.label} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="size-3.5" aria-hidden="true" />}
              {isLast || !("href" in item) ? (
                <span className={cn(isLast && "font-medium text-foreground")}>{item.label}</span>
              ) : (
                <Link
                  href={item.href}
                  className="hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {item.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      <nav aria-label="Organization sections" className="flex flex-wrap gap-2">
        {organizationNavigation.map((item) => {
          const Icon = item.icon;
          const href =
            item.href.length === 0
              ? `/organizations/${organization.id}`
              : `/organizations/${organization.id}/${item.href}`;
          const isActive = pathname === href;
          return (
            <Link
              key={item.label}
              href={href}
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
  );
}

export { OrganizationHeader };
