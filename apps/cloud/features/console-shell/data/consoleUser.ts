import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";

import { requirePlatformAdmin, resolveOrgRole } from "@/lib/auth/guards";
import { member, organization } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

type ConsoleUserMenu = {
  user: { name: string; email: string };
  adminOrgs: { id: string; name: string }[];
};

const loadConsoleUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConsoleUserMenu> => {
    const session = await requirePlatformAdmin();

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

    return {
      user: { name: session.user.name, email: session.user.email },
      adminOrgs,
    };
  },
);

export { loadConsoleUser };
export type { ConsoleUserMenu };
