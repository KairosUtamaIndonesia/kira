import { eq } from "drizzle-orm";

import type { Organization, OrganizationMember } from "@/features/organizations/types";

import { organizationDesktopAccessConfigId } from "@/features/organizations/data/organizationApiKeys";
import { apikey, member, organization, user } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

type OrganizationCounts = {
  members: Map<string, number>;
  apiKeys: Map<string, number>;
};

async function getOrganizationCounts(): Promise<OrganizationCounts> {
  const [memberRows, apiKeyRows] = await Promise.all([
    db.select({ organizationId: member.organizationId }).from(member),
    db
      .select({ organizationId: apikey.referenceId })
      .from(apikey)
      .where(eq(apikey.configId, organizationDesktopAccessConfigId)),
  ]);

  const members = new Map<string, number>();
  const apiKeys = new Map<string, number>();

  for (const row of memberRows) {
    members.set(row.organizationId, (members.get(row.organizationId) ?? 0) + 1);
  }

  for (const row of apiKeyRows) {
    apiKeys.set(row.organizationId, (apiKeys.get(row.organizationId) ?? 0) + 1);
  }

  return { members, apiKeys };
}

function toOrganizationRow(
  row: typeof organization.$inferSelect,
  counts: OrganizationCounts,
): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: "active",
    memberCount: counts.members.get(row.id) ?? 0,
    apiKeyCount: counts.apiKeys.get(row.id) ?? 0,
    createdAt: formatDate(row.createdAt),
  };
}

async function listOrganizationsForAdmin(): Promise<Organization[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(organization).orderBy(organization.createdAt),
    getOrganizationCounts(),
  ]);

  return rows.map((row) => toOrganizationRow(row, counts));
}

async function getOrganizationForAdmin(organizationId: string): Promise<Organization | undefined> {
  const [row] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (row === undefined) {
    return undefined;
  }

  return toOrganizationRow(row, await getOrganizationCounts());
}

async function listOrganizationMembersForAdmin(
  organizationId: string,
): Promise<OrganizationMember[]> {
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

export { getOrganizationForAdmin, listOrganizationMembersForAdmin, listOrganizationsForAdmin };
