import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Building2, Globe, ShieldCheck, Users } from "lucide-react";

import type { DashboardSsoConnection } from "@/features/sso/data/dashboardSso";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { listOrganizationsForPlatform } from "@/features/platform/organizations/data/organizations";
import { listDashboardSsoConnections } from "@/features/sso/data/dashboardSso";
import { requirePlatformAdmin } from "@/lib/auth/guards";

const loadDashboard = createServerFn().handler(async () => {
  await requirePlatformAdmin();
  const [organizations, ssoConnections] = await Promise.all([
    listOrganizationsForPlatform(),
    listDashboardSsoConnections(),
  ]);

  return { organizations, ssoConnections };
});

export const Route = createFileRoute("/_console/dashboard")({
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
          icon={Building2}
        />
        <MetricCard
          label="Members"
          value={memberTotal.toString()}
          detail="Across all organizations"
          icon={Users}
        />
        <MetricCard
          label="SSO providers"
          value={ssoConnections.length.toString()}
          detail="Organization-scoped identity providers"
          icon={ShieldCheck}
        />
        <MetricCard
          label="Pending verification"
          value={pendingSsoVerificationTotal.toString()}
          detail="SSO domains awaiting DNS verification"
          icon={Globe}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-medium">Single Sign-On</h2>
            <p className="text-sm text-muted-foreground">
              Organization identity providers and domain verification status.
            </p>
          </div>
          <Button render={<Link to="/organizations" />} nativeButton={false} variant="outline">
            Configure SSO
          </Button>
        </div>
        {ssoConnections.length === 0 ? (
          <SsoEmptyState />
        ) : (
          <SsoTable connections={ssoConnections} />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetricCard
// ---------------------------------------------------------------------------

type MetricCardProperties = {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
};

function MetricCard({ label, value, detail, icon: Icon }: MetricCardProperties) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 text-card-foreground transition-all duration-200 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// SSO empty state
// ---------------------------------------------------------------------------

function SsoEmptyState() {
  return (
    <Empty>
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
        <ShieldCheck aria-hidden className="size-6 text-muted-foreground" />
      </div>
      <EmptyHeader>
        <EmptyTitle>No SSO providers configured</EmptyTitle>
        <EmptyDescription>
          Open an organization's settings page to register Azure Entra ID SSO.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// SSO table
// ---------------------------------------------------------------------------

function SsoStatusBadge({ status }: { status: DashboardSsoConnection["status"] }): ReactNode {
  if (status === "active") {
    return (
      <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        Active
      </Badge>
    );
  }
  return (
    <Badge className="border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400">
      Pending verification
    </Badge>
  );
}

type SsoTableProperties = {
  connections: DashboardSsoConnection[];
};

function SsoTable({ connections }: SsoTableProperties) {
  return (
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
          {connections.map((connection) => (
            <tr
              key={connection.id}
              className="border-b border-border transition-colors last:border-0 hover:bg-muted/50"
            >
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
              <td className="py-3 pr-4">
                <SsoStatusBadge status={connection.status} />
              </td>
              <td className="py-3 pr-4">
                <Link
                  to="/org/$organizationId/settings"
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
  );
}
