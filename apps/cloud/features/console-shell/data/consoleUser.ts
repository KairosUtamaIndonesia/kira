import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray } from "drizzle-orm";

import { requirePlatformAdmin } from "@/lib/auth/guards";
import { member, organization } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

type ConsoleUserMenu = {
  user: { name: string; email: string };
  adminOrgs: { id: string; name: string }[];
};

const loadConsoleUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConsoleUserMenu> => {
    const session = await requirePlatformAdmin();

    const orgs = await db
      .select({ id: member.organizationId, name: organization.name })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.userId, session.user.id), inArray(member.role, ["owner", "admin"])));

    return {
      user: { name: session.user.name, email: session.user.email },
      adminOrgs: orgs,
    };
  },
);

export { loadConsoleUser };
export type { ConsoleUserMenu };
