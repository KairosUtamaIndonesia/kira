import { notFound } from "next/navigation";

import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import { getOrganizationForAdmin } from "@/features/organizations/data/organizations";

const roles = ["Owner", "Admin", "Member", "Billing", "Viewer"];
const permissions = [
  "organization.read",
  "organization.update",
  "member.invite",
  "member.update-role",
  "member.remove",
  "apiKey.create",
  "apiKey.revoke",
  "desktopAccess.grant",
  "desktopAccess.revoke",
];

type AccessControlPageProperties = {
  params: Promise<{ organizationId: string }>;
};

export default async function AccessControlPage({ params }: AccessControlPageProperties) {
  const { organizationId } = await params;
  const organization = await getOrganizationForAdmin(organizationId);

  if (organization === undefined) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />
      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="mb-4">
          <h2 className="font-medium">Access Control</h2>
          <p className="text-sm text-muted-foreground">
            Role and permission display for the first RBAC pass.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="space-y-2">
            {roles.map((role) => (
              <article key={role} className="rounded-lg border border-border p-3">
                <h3 className="font-medium">{role}</h3>
                <p className="text-sm text-muted-foreground">
                  Permission set managed by Better Auth.
                </p>
              </article>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="p-3 font-medium">Permission</th>
                  {roles.map((role) => (
                    <th key={role} className="p-3 font-medium">
                      {role}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissions.map((permission) => (
                  <tr key={permission} className="border-b border-border last:border-0">
                    <td className="p-3 font-mono text-xs">{permission}</td>
                    {roles.map((role) => (
                      <td key={`${role}-${permission}`} className="p-3 text-muted-foreground">
                        Display only
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
