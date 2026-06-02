import Link from "next/link";

import { Button } from "@/components/ui/button";
import { listOrganizations } from "@/features/organizations/data/mockOrganizations";

export default function DashboardPage() {
  const organizations = listOrganizations();
  const memberTotal = organizations.reduce(
    (total, organization) => total + organization.memberCount,
    0,
  );
  const apiKeyTotal = organizations.reduce(
    (total, organization) => total + organization.apiKeyCount,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Admin overview</p>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <Button render={<Link href="/organizations" />} variant="outline">
          View organizations
        </Button>
      </div>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Organizations"
          value={organizations.length.toString()}
          detail="Managed SaaS organizations"
        />
        <MetricCard
          label="Members"
          value={memberTotal.toString()}
          detail="Across known organizations"
        />
        <MetricCard
          label="API Keys"
          value={apiKeyTotal.toString()}
          detail="Organization-owned credentials"
        />
        <MetricCard
          label="Desktop checks"
          value="Pending"
          detail="Connected in the auth/API phase"
        />
      </section>
      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="mb-4">
          <h2 className="font-medium">Recent organizations</h2>
          <p className="text-sm text-muted-foreground">
            Static UI data until Better Auth is wired.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground uppercase">
              <tr>
                <th className="py-2 pr-4 font-medium">Organization</th>
                <th className="py-2 pr-4 font-medium">Slug</th>
                <th className="py-2 pr-4 font-medium">Members</th>
                <th className="py-2 pr-4 font-medium">API Keys</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((organization) => (
                <tr key={organization.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 font-medium">
                    <Link href={`/organizations/${organization.id}`} className="hover:underline">
                      {organization.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{organization.slug}</td>
                  <td className="py-3 pr-4">{organization.memberCount}</td>
                  <td className="py-3 pr-4">{organization.apiKeyCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
