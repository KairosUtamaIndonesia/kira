import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray } from "drizzle-orm";

import { requireOrgRole } from "@/lib/auth/guards";
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

    const adminOrgs = await db
      .select({ id: member.organizationId, name: organization.name })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.userId, session.user.id), inArray(member.role, ["owner", "admin"])));

    return { org: orgRow, adminOrgs, isPlatformAdmin: session.user.role === "admin" };
  });

export { loadOrgAdminLayout };
export type { OrgAdminLayoutData, OrgAdminLayoutOrg };
