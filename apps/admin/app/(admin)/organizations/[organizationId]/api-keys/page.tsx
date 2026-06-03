import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import { listOrganizationApiKeysForAdmin } from "@/features/organizations/data/organizationApiKeys";
import { getOrganizationForAdmin } from "@/features/organizations/data/organizations";

type ApiKeysPageProperties = {
  params: Promise<{ organizationId: string }>;
};

export default async function ApiKeysPage({ params }: ApiKeysPageProperties) {
  const { organizationId } = await params;
  const organization = await getOrganizationForAdmin(organizationId);

  if (organization === undefined) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />
      <Suspense fallback={<ApiKeysTableLoading />}>
        <ApiKeysTable organizationId={organization.id} />
      </Suspense>
    </div>
  );
}

type ApiKeysTableProperties = {
  organizationId: string;
};

async function ApiKeysTable({ organizationId }: ApiKeysTableProperties) {
  const apiKeys = await listOrganizationApiKeysForAdmin(organizationId);

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">API Keys</h2>
          <p className="text-sm text-muted-foreground">
            Organization-owned keys for Kira desktop access checks.
          </p>
        </div>
        <Button disabled>Create API key</Button>
      </div>
      {apiKeys.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No API keys found</EmptyTitle>
            <EmptyDescription>
              Create an organization-owned desktop access key to populate this table.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground uppercase">
              <tr>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Prefix</th>
                <th className="py-2 pr-4 font-medium">Start</th>
                <th className="py-2 pr-4 font-medium">Permissions</th>
                <th className="py-2 pr-4 font-medium">Last used</th>
                <th className="py-2 pr-4 font-medium">Expires</th>
                <th className="py-2 pr-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {apiKeys.map((apiKey) => (
                <tr key={apiKey.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 font-medium">{apiKey.name}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">
                    {apiKey.prefix}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">
                    {apiKey.start}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {apiKey.permissions.length === 0 ? "None" : apiKey.permissions.join(", ")}
                  </td>
                  <td className="py-3 pr-4">{apiKey.lastUsedAt}</td>
                  <td className="py-3 pr-4">{apiKey.expiresAt}</td>
                  <td className="py-3 pr-4 capitalize">{apiKey.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ApiKeysTableLoading() {
  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <p className="text-sm text-muted-foreground">Loading organization API keys…</p>
    </section>
  );
}
