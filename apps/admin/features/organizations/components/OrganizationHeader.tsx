import Link from "next/link";

import type { Organization } from "@/features/organizations/types";

import { organizationNavigation } from "@/features/admin-shell/navigation";

type OrganizationHeaderProperties = {
  organization: Organization;
};

function OrganizationHeader({ organization }: OrganizationHeaderProperties) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Organization</p>
        <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
        <p className="text-sm text-muted-foreground">{organization.slug}</p>
      </div>
      <nav aria-label="Organization sections" className="flex flex-wrap gap-2">
        {organizationNavigation.map((item) => {
          const Icon = item.icon;
          const href =
            item.href.length === 0
              ? `/organizations/${organization.id}`
              : `/organizations/${organization.id}/${item.href}`;
          return (
            <Link
              key={item.label}
              href={href}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export { OrganizationHeader };
