import { notFound } from "next/navigation";

import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import {
  getOrganization,
  listOrganizationApiKeys,
  listOrganizationMembers,
} from "@/features/organizations/data/mockOrganizations";

type OrganizationPageProperties = {
  params: Promise<{ organizationId: string }>;
};

export default async function OrganizationPage({ params }: OrganizationPageProperties) {
  const { organizationId } = await params;
  const organization = getOrganization(organizationId);

  if (organization === undefined) {
    notFound();
  }

  const members = listOrganizationMembers(organization.id);
  const apiKeys = listOrganizationApiKeys(organization.id);

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />
      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="Members"
          value={members.length.toString()}
          detail="Loaded from mock organization members"
        />
        <SummaryCard
          label="API Keys"
          value={apiKeys.length.toString()}
          detail="Organization-owned desktop credentials"
        />
        <SummaryCard
          label="Status"
          value={organization.status}
          detail="Status display only until auth is wired"
        />
      </section>
      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <h2 className="font-medium">Desktop access policy</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The phone-home endpoint will validate organization-owned API keys and fail closed when
          access cannot be confirmed.
        </p>
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
