import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq, sql } from "drizzle-orm";

import { auth } from "@/lib/auth/auth";
import { resolveOrgRole } from "@/lib/auth/guards";
import { account, invitation, member, organization, ssoProvider } from "@/lib/db/auth-schema";
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
    const headers = getRequest().headers;
    const session = await auth.api.getSession({ headers });

    if (session === null) {
      return { kind: "member-only" };
    }

    if (session.user.role === "platform_admin") {
      return { kind: "console" };
    }

    let orgs = await db
      .select({ id: member.organizationId, name: organization.name, role: member.role })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, session.user.id));

    // Auto-accept pending invitations — only when the user authenticated via a
    // domain-verified SSO provider whose domain matches their email.  The SSO
    // handshake already proved email ownership; the domainVerified flag means
    // the org controls the domain.  Together they make bare-email auto-accept
    // safe: an attacker registering with a victim's email cannot bypass SSO
    // authentication for that domain.
    //
    // Without this, an invited member who signs in via SSO (no invitationId in
    // the URL — e.g. desktop app flow) never becomes a member and lands on
    // /access or "no-organization" instead of completing sign-in.
    if (orgs.length === 0) {
      const [pendingInvitation] = await db
        .select({ id: invitation.id })
        .from(invitation)
        .innerJoin(organization, eq(organization.id, invitation.organizationId))
        .innerJoin(ssoProvider, eq(ssoProvider.organizationId, organization.id))
        .innerJoin(
          account,
          and(eq(account.userId, session.user.id), eq(account.providerId, ssoProvider.providerId)),
        )
        .where(
          and(
            sql`LOWER(${invitation.email}) = LOWER(${session.user.email})`,
            eq(invitation.status, "pending"),
            eq(ssoProvider.domainVerified, true),
            sql`${ssoProvider.domain} = SPLIT_PART(LOWER(${session.user.email}), '@', 2)`,
          ),
        )
        .limit(1);

      if (pendingInvitation !== undefined) {
        await auth.api.acceptInvitation({
          headers,
          body: { invitationId: pendingInvitation.id },
        });

        orgs = await db
          .select({ id: member.organizationId, name: organization.name, role: member.role })
          .from(member)
          .innerJoin(organization, eq(organization.id, member.organizationId))
          .where(eq(member.userId, session.user.id));
      }
    }

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
