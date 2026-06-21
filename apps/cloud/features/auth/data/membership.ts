import { and, eq } from "drizzle-orm";

import { invitation, member, organization, session, ssoProvider } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

type InvitationSignInContext = {
  invitedEmail: string;
  organizationName: string;
  organizationSlug: string;
  ssoRequired: boolean;
  isExpired: boolean;
};

type MembershipOrganization = { id: string; name: string };

async function getInvitationSignInContext(
  invitationId: string,
): Promise<InvitationSignInContext | undefined> {
  const [row] = await db
    .select({
      email: invitation.email,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      ssoProviderId: ssoProvider.id,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .leftJoin(
      ssoProvider,
      and(eq(ssoProvider.organizationId, organization.id), eq(ssoProvider.domainVerified, true)),
    )
    .where(and(eq(invitation.id, invitationId), eq(invitation.status, "pending")))
    .limit(1);

  if (row === undefined) {
    return undefined;
  }

  return {
    invitedEmail: row.email,
    organizationName: row.organizationName,
    organizationSlug: row.organizationSlug,
    ssoRequired: row.ssoProviderId !== null,
    isExpired: row.expiresAt.getTime() <= Date.now(),
  };
}

async function getInvitationEmailForSignIn(invitationId: string): Promise<string | undefined> {
  const context = await getInvitationSignInContext(invitationId);

  if (context === undefined) {
    return undefined;
  }

  return context.invitedEmail;
}

async function getActiveOrganizationIdForCurrentSession(
  sessionId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ activeOrganizationId: session.activeOrganizationId })
    .from(session)
    .where(eq(session.id, sessionId))
    .limit(1);

  if (row === undefined) {
    return undefined;
  }

  if (row.activeOrganizationId === null) {
    return undefined;
  }

  return row.activeOrganizationId;
}

// Organizations the user belongs to, used to scope desktop sign-in to the
// member's own organizations.
async function listOrganizationsForMember(userId: string): Promise<MembershipOrganization[]> {
  return db
    .select({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(organization.name);
}

async function userBelongsToOrganization(userId: string, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);

  return row !== undefined;
}

export {
  getActiveOrganizationIdForCurrentSession,
  getInvitationEmailForSignIn,
  getInvitationSignInContext,
  listOrganizationsForMember,
  userBelongsToOrganization,
};
export type { InvitationSignInContext, MembershipOrganization };
