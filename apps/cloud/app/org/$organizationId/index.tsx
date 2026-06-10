import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { CheckCircle2, KeyRound, Users } from "lucide-react";

import type { OrganizationStatus } from "@/features/organizations/types";

import { Badge } from "@/components/ui/badge";
import { listOrgApiKeys } from "@/features/org-admin/api-keys/data/apiKeys";
import { listOrgMembers } from "@/features/org-admin/members/data/members";
import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import { getOrganizationForPlatform } from "@/features/platform/organizations/data/organizations";
import { requireOrgRole } from "@/lib/auth/guards";

const loadOrganization = createServerFn()
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }) => {
    await requireOrgRole(organizationId);
    const organization = await getOrganizationForPlatform(organizationId);

    if (organization === undefined) {
      throw notFound();
    }

    const [members, apiKeys] = await Promise.all([
      listOrgMembers(organizationId),
      listOrgApiKeys(organizationId),
    ]);

    return { organization, members, apiKeys };
  });

export const Route = createFileRoute("/org/$organizationId/")({
  loader: ({ params }) => loadOrganization({ data: params.organizationId }),
  component: OrganizationPage,
});

function OrganizationPage() {
  const { organization, members, apiKeys } = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />
      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="Members"
          value={members.length.toString()}
          detail="Active organization members"
          icon={Users}
        />
        <SummaryCard
          label="API Keys"
          value={apiKeys.length.toString()}
          detail="Active desktop credentials"
          icon={KeyRound}
        />
        <SummaryCard
          label="Status"
          value={<OrgStatusBadge status={organization.status} />}
          detail="Organization state"
          icon={CheckCircle2}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrgStatusBadge
// ---------------------------------------------------------------------------

function OrgStatusBadge({ status }: { status: OrganizationStatus }): ReactNode {
  if (status === "active") {
    return (
      <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        Active
      </Badge>
    );
  }
  // Future statuses render as plain outline badges.
  return <Badge variant="outline">{status}</Badge>;
}

// ---------------------------------------------------------------------------
// SummaryCard
// ---------------------------------------------------------------------------

type SummaryCardProperties = {
  label: string;
  value: string | ReactNode;
  detail: string;
  icon: LucideIcon;
};

function SummaryCard({ label, value, detail, icon: Icon }: SummaryCardProperties) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 text-card-foreground transition-all duration-200 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <div className="mt-2 text-xl font-semibold tracking-tight">{value}</div>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
        </div>
      </div>
    </article>
  );
}
