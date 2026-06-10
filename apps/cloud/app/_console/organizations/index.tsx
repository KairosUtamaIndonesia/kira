import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { CreateOrganizationForm } from "@/features/organizations/components/CreateOrganizationForm";
import { listOrganizationsForPlatform } from "@/features/platform/organizations/data/organizations";

const loadOrganizations = createServerFn().handler(() => listOrganizationsForPlatform());

export const Route = createFileRoute("/_console/organizations/")({
  loader: () => loadOrganizations(),
  component: OrganizationsPage,
});

function OrganizationsPage() {
  const organizations = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">SaaS administration</p>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
        </div>
      </div>
      <CreateOrganizationForm />
      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="mb-4">
          <div>
            <h2 className="font-medium">Managed organizations</h2>
            <p className="text-sm text-muted-foreground">
              Real Better Auth organization data for Kira SaaS administration.
            </p>
          </div>
        </div>
        {organizations.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No organizations found</EmptyTitle>
              <EmptyDescription>
                Create a Better Auth organization to populate this table.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="py-2 pr-4 font-medium">Organization</th>
                  <th className="py-2 pr-4 font-medium">Slug</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Members</th>
                  <th className="py-2 pr-4 font-medium">API Keys</th>
                  <th className="py-2 pr-4 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((organization) => (
                  <tr key={organization.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 font-medium">
                      <Link
                        to="/organizations/$organizationId"
                        params={{ organizationId: organization.id }}
                        className="hover:underline"
                      >
                        {organization.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{organization.slug}</td>
                    <td className="py-3 pr-4 capitalize">{organization.status}</td>
                    <td className="py-3 pr-4">{organization.memberCount}</td>
                    <td className="py-3 pr-4">{organization.apiKeyCount}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{organization.createdAt}</td>
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
