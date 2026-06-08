import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import { listOrganizationApiKeysForAdmin } from "@/features/organizations/data/organizationApiKeys";
import {
  getOrganizationForAdmin,
  listOrganizationMembersForAdmin,
} from "@/features/organizations/data/organizations";

type OrganizationPageProperties = {
  params: Promise<{ organizationId: string }>;
};

export default async function OrganizationPage({ params }: OrganizationPageProperties) {
  const { organizationId } = await params;
  const organization = await getOrganizationForAdmin(organizationId);

  if (organization === undefined) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />
      <Suspense fallback={<SummaryLoading />}>
        <OrganizationSummary organizationId={organization.id} status={organization.status} />
      </Suspense>
    </div>
  );
}

type OrganizationSummaryProperties = {
  organizationId: string;
  status: string;
};

async function OrganizationSummary({ organizationId, status }: OrganizationSummaryProperties) {
  const [members, apiKeys] = await Promise.all([
    listOrganizationMembersForAdmin(organizationId),
    listOrganizationApiKeysForAdmin(organizationId),
  ]);

  return (
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
      <SummaryCard label="Status" value={status} detail="Derived from organization state" />
    </section>
  );
}

function SummaryLoading() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <SummaryCard label="Members" value="…" detail="Loading organization members" />
      <SummaryCard label="API Keys" value="…" detail="Loading desktop credentials" />
      <SummaryCard label="Status" value="…" detail="Loading organization state" />
    </section>
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
