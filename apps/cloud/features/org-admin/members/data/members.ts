import { eq } from "drizzle-orm";

import type { OrganizationInvitation, OrganizationMember } from "@/features/organizations/types";

import { invitation, member, user } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function listOrgMembers(organizationId: string): Promise<OrganizationMember[]> {
  const rows = await db
    .select({
      id: member.id,
      organizationId: member.organizationId,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(member.createdAt);

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    email: row.email,
    role: row.role,
    status: "active",
    joinedAt: formatDate(row.joinedAt),
  }));
}

async function listOrgInvitations(organizationId: string): Promise<OrganizationInvitation[]> {
  const rows = await db
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      invitedAt: invitation.createdAt,
    })
    .from(invitation)
    .where(eq(invitation.organizationId, organizationId))
    .orderBy(invitation.createdAt);

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role ?? "member",
    status: row.status,
    expiresAt: formatDate(row.expiresAt),
    invitedAt: formatDate(row.invitedAt),
  }));
}

export { listOrgInvitations, listOrgMembers };
