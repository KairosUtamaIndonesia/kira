import Link from "next/link";

import { Button } from "@/components/ui/button";
import { listOrganizations } from "@/features/organizations/data/mockOrganizations";

export default function OrganizationsPage() {
  const organizations = listOrganizations();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">SaaS administration</p>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
        </div>
        <Button disabled>Create organization</Button>
      </div>
      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-medium">Managed organizations</h2>
            <p className="text-sm text-muted-foreground">
              Better Auth organization data will replace these rows.
            </p>
          </div>
          <label className="w-full max-w-xs text-sm">
            <span className="sr-only">Search organizations</span>
            <input
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Search organizations"
              placeholder="Search organizations"
              disabled
            />
          </label>
        </div>
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
                    <Link href={`/organizations/${organization.id}`} className="hover:underline">
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
      </section>
    </div>
  );
}
