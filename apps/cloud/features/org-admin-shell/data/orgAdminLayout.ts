import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";

import { isPlatformAdmin, requireOrgRole, resolveOrgRole } from "@/lib/auth/guards";
import { member, organization } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

type OrgAdminLayoutOrg = { id: string; name: string };

type OrgAdminLayoutData = {
  org: OrgAdminLayoutOrg;
  adminOrgs: OrgAdminLayoutOrg[];
  isPlatformAdmin: boolean;
};

const loadOrgAdminLayout = createServerFn({ method: "GET" })
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }): Promise<OrgAdminLayoutData> => {
    const { session } = await requireOrgRole(organizationId);

    const [orgRow] = await db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1);

    if (orgRow === undefined) {
      throw new Error("Organization not found.");
    }

    const allMemberships = await db
      .select({ id: member.organizationId, name: organization.name, role: member.role })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, session.user.id));

    const adminOrgs = allMemberships
      .filter((m) => {
        const roleObj = resolveOrgRole(m.role);
        return roleObj !== undefined && roleObj.authorize({ org: ["update"] }).success;
      })
      .map((m) => ({ id: m.id, name: m.name }));

    return { org: orgRow, adminOrgs, isPlatformAdmin: isPlatformAdmin(session.user.role) };
  });

export { loadOrgAdminLayout };
export type { OrgAdminLayoutData, OrgAdminLayoutOrg };
