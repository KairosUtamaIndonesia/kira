import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { listOrganizationsForAdmin } from "@/features/organizations/data/organizations";
import { listDashboardSsoConnections } from "@/features/sso/data/dashboardSso";

const loadDashboard = createServerFn().handler(async () => {
  const [organizations, ssoConnections] = await Promise.all([
    listOrganizationsForAdmin(),
    listDashboardSsoConnections(),
  ]);

  return { organizations, ssoConnections };
});

export const Route = createFileRoute("/_admin/dashboard")({
  loader: () => loadDashboard(),
  component: DashboardPage,
});

function DashboardPage() {
  const { organizations, ssoConnections } = Route.useLoaderData();
  const memberTotal = organizations.reduce(
    (total, organization) => total + organization.memberCount,
    0,
  );
  const pendingSsoVerificationTotal = ssoConnections.filter(
    (connection) => connection.status === "pending_domain_verification",
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Admin overview</p>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <Button render={<Link to="/organizations" />} nativeButton={false} variant="outline">
          View organizations
        </Button>
      </div>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Organizations"
          value={organizations.length.toString()}
          detail="Managed SaaS organizations"
        />
        <MetricCard label="Members" value={memberTotal.toString()} detail="Across organizations" />
        <MetricCard
          label="SSO providers"
          value={ssoConnections.length.toString()}
          detail="Organization-scoped identity providers"
        />
        <MetricCard
          label="Domain verification"
          value={pendingSsoVerificationTotal.toString()}
          detail="SSO domains waiting for DNS verification"
        />
      </section>
      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-medium">Single Sign-On</h2>
            <p className="text-sm text-muted-foreground">
              Manage organization identity providers and domain verification.
            </p>
          </div>
          <Button render={<Link to="/organizations" />} nativeButton={false} variant="outline">
            Configure SSO
          </Button>
        </div>
        {ssoConnections.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No SSO providers configured</EmptyTitle>
              <EmptyDescription>
                Open an organization settings page to register Azure Entra ID SSO.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="py-2 pr-4 font-medium">Organization</th>
                  <th className="py-2 pr-4 font-medium">Domain</th>
                  <th className="py-2 pr-4 font-medium">Provider</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Manage</th>
                </tr>
              </thead>
              <tbody>
                {ssoConnections.map((connection) => (
                  <tr key={connection.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 font-medium">
                      <Link
                        to="/organizations/$organizationId"
                        params={{ organizationId: connection.organizationId }}
                        className="hover:underline"
                      >
                        {connection.organizationName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{connection.organizationSlug}</p>
                    </td>
                    <td className="py-3 pr-4">{connection.domain}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">
                      {connection.providerId}
                    </td>
                    <td className="py-3 pr-4 capitalize">
                      {connection.status.replaceAll("_", " ")}
                    </td>
                    <td className="py-3 pr-4">
                      <Link
                        to="/organizations/$organizationId/settings"
                        params={{ organizationId: connection.organizationId }}
                        className="text-sm font-medium hover:underline"
                      >
                        Manage SSO
                      </Link>
                    </td>
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

type MetricCardProperties = {
  label: string;
  value: string;
  detail: string;
};

function MetricCard({ label, value, detail }: MetricCardProperties) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </article>
  );
}
