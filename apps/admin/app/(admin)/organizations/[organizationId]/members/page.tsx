import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import {
  getOrganizationForAdmin,
  listOrganizationMembersForAdmin,
} from "@/features/organizations/data/organizations";

type MembersPageProperties = {
  params: Promise<{ organizationId: string }>;
};

export default async function MembersPage({ params }: MembersPageProperties) {
  const { organizationId } = await params;
  const organization = await getOrganizationForAdmin(organizationId);

  if (organization === undefined) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />
      <Suspense fallback={<MembersTableLoading />}>
        <MembersTable organizationId={organization.id} />
      </Suspense>
    </div>
  );
}

type MembersTableProperties = {
  organizationId: string;
};

async function MembersTable({ organizationId }: MembersTableProperties) {
  const members = await listOrganizationMembersForAdmin(organizationId);

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Members</h2>
          <p className="text-sm text-muted-foreground">Organization users and Better Auth roles.</p>
        </div>
        <Button disabled>Invite member</Button>
      </div>
      {members.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No members found</EmptyTitle>
            <EmptyDescription>
              This organization does not have any Better Auth members.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground uppercase">
              <tr>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 font-medium">{member.name}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{member.email}</td>
                  <td className="py-3 pr-4 capitalize">{member.role}</td>
                  <td className="py-3 pr-4 capitalize">{member.status}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{member.joinedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MembersTableLoading() {
  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <p className="text-sm text-muted-foreground">Loading organization members…</p>
    </section>
  );
}
