import { eq } from "drizzle-orm";

import type { OrganizationSsoConnection } from "@/features/sso/types";

import { ssoProvider } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

function toSsoConnection(row: typeof ssoProvider.$inferSelect): OrganizationSsoConnection {
  if (row.organizationId === null) {
    throw new Error(`SSO provider is not linked to an organization: ${row.providerId}`);
  }

  const domainVerified = row.domainVerified === true;

  return {
    id: row.id,
    organizationId: row.organizationId,
    providerId: row.providerId,
    issuer: row.issuer,
    domain: row.domain,
    domainVerified,
    status: domainVerified ? "active" : "pending_domain_verification",
  };
}

async function getOrganizationSsoConnection(
  organizationId: string,
): Promise<OrganizationSsoConnection | undefined> {
  const [row] = await db
    .select()
    .from(ssoProvider)
    .where(eq(ssoProvider.organizationId, organizationId))
    .limit(1);

  if (row === undefined) {
    return undefined;
  }

  return toSsoConnection(row);
}

export { getOrganizationSsoConnection };
