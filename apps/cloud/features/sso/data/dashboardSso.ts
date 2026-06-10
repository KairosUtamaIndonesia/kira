import { eq } from "drizzle-orm";

import { organization, ssoProvider } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

type DashboardSsoConnection = {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  providerId: string;
  domain: string;
  issuer: string;
  domainVerified: boolean;
  status: "active" | "pending_domain_verification";
};

function toDashboardSsoConnection(row: {
  id: string;
  organizationId: string | null;
  organizationName: string;
  organizationSlug: string;
  providerId: string;
  domain: string;
  issuer: string;
  domainVerified: boolean | null;
}): DashboardSsoConnection {
  if (row.organizationId === null) {
    throw new Error(`SSO provider is not linked to an organization: ${row.providerId}`);
  }

  const domainVerified = row.domainVerified === true;

  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    organizationSlug: row.organizationSlug,
    providerId: row.providerId,
    domain: row.domain,
    issuer: row.issuer,
    domainVerified,
    status: domainVerified ? "active" : "pending_domain_verification",
  };
}

async function listDashboardSsoConnections(): Promise<DashboardSsoConnection[]> {
  const rows = await db
    .select({
      id: ssoProvider.id,
      organizationId: ssoProvider.organizationId,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      providerId: ssoProvider.providerId,
      domain: ssoProvider.domain,
      issuer: ssoProvider.issuer,
      domainVerified: ssoProvider.domainVerified,
    })
    .from(ssoProvider)
    .innerJoin(organization, eq(organization.id, ssoProvider.organizationId))
    .orderBy(organization.name);

  return rows.map(toDashboardSsoConnection);
}

export { listDashboardSsoConnections };
export type { DashboardSsoConnection };
