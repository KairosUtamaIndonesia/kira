import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import {
  InviteMemberForm,
  MemberActions,
} from "@/features/organizations/components/OrganizationMemberForms";
import {
  getOrganizationForAdmin,
  listOrganizationInvitationsForAdmin,
  listOrganizationMembersForAdmin,
} from "@/features/organizations/data/organizations";

const loadMembers = createServerFn()
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }) => {
    const organization = await getOrganizationForAdmin(organizationId);

    if (organization === undefined) {
      throw notFound();
    }

    const [members, invitations] = await Promise.all([
      listOrganizationMembersForAdmin(organizationId),
      listOrganizationInvitationsForAdmin(organizationId),
    ]);

    return { organization, members, invitations };
  });

export const Route = createFileRoute("/_admin/organizations/$organizationId/members")({
  loader: ({ params }) => loadMembers({ data: params.organizationId }),
  component: MembersPage,
});

function MembersPage() {
  const { organization, members, invitations } = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />
      <InviteMemberForm organizationId={organization.id} />
      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Members</h2>
            <p className="text-sm text-muted-foreground">
              Organization users and Better Auth roles.
            </p>
          </div>
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
                  <th className="py-2 pr-4 font-medium">Actions</th>
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
                    <td className="py-3 pr-4">
                      <MemberActions member={member} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {invitations.length > 0 ? (
          <div className="mt-6">
            <h3 className="mb-3 font-medium">Pending invitations</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Email</th>
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Expires</th>
                    <th className="py-2 pr-4 font-medium">Invited</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invitation) => (
                    <tr key={invitation.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4 font-medium">{invitation.email}</td>
                      <td className="py-3 pr-4 capitalize">{invitation.role}</td>
                      <td className="py-3 pr-4 capitalize">{invitation.status}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{invitation.expiresAt}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{invitation.invitedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : undefined}
      </section>
    </div>
  );
}
