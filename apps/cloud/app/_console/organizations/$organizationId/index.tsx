import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { ConsoleBreadcrumbSetter } from "@/features/console-shell/components/ConsoleBreadcrumbs";
import { listOrganizationApiKeysForAdmin } from "@/features/organizations/data/organizationApiKeys";
import {
  getOrganizationForPlatform,
  listOrganizationMembersForPlatform,
} from "@/features/platform/organizations/data/organizations";
import { requirePlatformAdmin } from "@/lib/auth/guards";

const loadOrganization = createServerFn()
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }) => {
    await requirePlatformAdmin();
    const organization = await getOrganizationForPlatform(organizationId);

    if (organization === undefined) {
      throw notFound();
    }

    const [members, apiKeys] = await Promise.all([
      listOrganizationMembersForPlatform(organizationId),
      listOrganizationApiKeysForAdmin(organizationId),
    ]);

    return { organization, members, apiKeys };
  });

export const Route = createFileRoute("/_console/organizations/$organizationId/")({
  loader: ({ params }) => loadOrganization({ data: params.organizationId }),
  component: OrganizationPage,
});

function OrganizationPage() {
  const { organization, members, apiKeys } = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <ConsoleBreadcrumbSetter
        items={[{ label: "Organizations", href: "/organizations" }, { label: organization.name }]}
      />
      <div>
        <p className="text-sm text-muted-foreground">Organization</p>
        <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
        <p className="text-sm text-muted-foreground">{organization.slug}</p>
      </div>
      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="Members"
          value={members.length.toString()}
          detail="Active organization members"
        />
        <SummaryCard
          label="API Keys"
          value={apiKeys.length.toString()}
          detail="Active desktop credentials"
        />
        <SummaryCard label="Status" value={organization.status} detail="Organization state" />
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
