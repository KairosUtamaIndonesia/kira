import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

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
          detail="Loaded from Better Auth organization members"
        />
        <SummaryCard
          label="API Keys"
          value={apiKeys.length.toString()}
          detail="Organization-owned desktop credentials"
        />
        <SummaryCard
          label="Status"
          value={organization.status}
          detail="Derived from organization state"
        />
      </section>
    </div>
  );
}

type SummaryCardProperties = {
  label: string;
  value: string;
  detail: string;
};

function SummaryCard({ label, value, detail }: SummaryCardProperties) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight capitalize">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </article>
  );
}
