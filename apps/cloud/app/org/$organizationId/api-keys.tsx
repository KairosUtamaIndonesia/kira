import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { listOrgApiKeys } from "@/features/org-admin/api-keys/data/apiKeys";
import { getOrganizationForPlatform } from "@/features/platform/organizations/data/organizations";
import { requireOrgRole } from "@/lib/auth/guards";

const loadApiKeys = createServerFn()
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }) => {
    await requireOrgRole(organizationId);
    const organization = await getOrganizationForPlatform(organizationId);

    if (organization === undefined) {
      throw notFound();
    }

    const apiKeys = await listOrgApiKeys(organizationId);

    return { organization, apiKeys };
  });

export const Route = createFileRoute("/org/$organizationId/api-keys")({
  loader: ({ params }) => loadApiKeys({ data: params.organizationId }),
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const { organization, apiKeys } = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">{organization.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
      </div>
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
    </div>
  );
}
