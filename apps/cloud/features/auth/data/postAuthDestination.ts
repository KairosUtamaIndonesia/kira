import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth/auth";
import { resolveOrgRole } from "@/lib/auth/guards";
import { member, organization } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

type PostAuthDestination =
  | { kind: "console" }
  | { kind: "org"; organizationId: string }
  | { kind: "org-picker"; organizations: { id: string; name: string }[] }
  | { kind: "member-only" };

// Resolves where an authenticated user should land after sign-in.
//
// - Platform admin → Console (/dashboard)
// - Org owner/admin of exactly one org → that org (/org/:id)
// - Org owner/admin of >1 orgs → org-picker (caller renders the list)
// - Plain member (no owner/admin role anywhere) → member-only terminal
//
// Unauthenticated returns `member-only`; actual route guards are the trust
// boundary. This fn only decides where to send the browser.
const resolvePostAuthDestination = createServerFn({ method: "GET" }).handler(
  async (): Promise<PostAuthDestination> => {
    const session = await auth.api.getSession({ headers: getRequest().headers });

    if (session === null) {
      return { kind: "member-only" };
    }

    if (session.user.role === "platform_admin") {
      return { kind: "console" };
    }

    const orgs = await db
      .select({ id: member.organizationId, name: organization.name, role: member.role })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, session.user.id));

    const adminOrgs = orgs.filter((r) => {
      const roleObj = resolveOrgRole(r.role);
      return roleObj !== undefined && roleObj.authorize({ org: ["update"] }).success;
    });

    if (adminOrgs.length === 0) {
      return { kind: "member-only" };
    }

    if (adminOrgs.length === 1) {
      const firstOrg = adminOrgs[0];
      if (firstOrg === undefined) return { kind: "member-only" };
      return { kind: "org", organizationId: firstOrg.id };
    }

    return {
      kind: "org-picker",
      organizations: adminOrgs.map((r) => ({ id: r.id, name: r.name })),
    };
  },
);

export { resolvePostAuthDestination };
export type { PostAuthDestination };
