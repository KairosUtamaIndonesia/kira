import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import {
  getOrganization,
  listOrganizationMembers,
} from "@/features/organizations/data/mockOrganizations";

type MembersPageProperties = {
  params: Promise<{ organizationId: string }>;
};

export default async function MembersPage({ params }: MembersPageProperties) {
  const { organizationId } = await params;
  const organization = getOrganization(organizationId);

  if (organization === undefined) {
    notFound();
  }

  const members = listOrganizationMembers(organization.id);

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />
      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Members</h2>
            <p className="text-sm text-muted-foreground">
              Organization users and Better Auth roles.
            </p>
          </div>
          <Button disabled>Invite member</Button>
        </div>
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
      </section>
    </div>
  );
}
