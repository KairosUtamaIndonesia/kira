import { and, eq, sql } from "drizzle-orm";

import type { OrganizationApiKey } from "@/features/organizations/types";

import { apikey } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

const organizationDesktopAccessConfigId = "organization-desktop-access";

function formatDate(date: Date | null) {
  if (date === null) {
    return "Never";
  }

  return date.toISOString().slice(0, 10);
}

function parsePermissions(value: string | null) {
  if (value === null || value.length === 0) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);

  if (Array.isArray(parsed) && parsed.every((permission) => typeof permission === "string")) {
    return parsed;
  }

  if (typeof parsed === "object" && parsed !== null) {
    return Object.entries(parsed).flatMap(([resource, actions]) => {
      if (!Array.isArray(actions) || !actions.every((action) => typeof action === "string")) {
        throw new Error(`Unexpected API key permission actions for ${resource}.`);
      }

      return actions.map((action) => `${resource}:${action}`);
    });
  }

  throw new Error("Unexpected API key permissions format.");
}

function apiKeyStatus(enabled: boolean | null, expiresAt: Date | null) {
  if (enabled === false) {
    return "disabled";
  }

  if (expiresAt !== null && expiresAt.getTime() <= Date.now()) {
    return "expired";
  }

  return "active";
}

async function listOrgApiKeys(organizationId: string): Promise<OrganizationApiKey[]> {
  const rows = await db
    .select({
      id: apikey.id,
      name: apikey.name,
      prefix: apikey.prefix,
      start: apikey.start,
      permissions: apikey.permissions,
      lastRequest: apikey.lastRequest,
      expiresAt: apikey.expiresAt,
      enabled: apikey.enabled,
    })
    .from(apikey)
    .where(
      and(
        eq(apikey.configId, organizationDesktopAccessConfigId),
        sql`${apikey.metadata}::jsonb @> ${JSON.stringify({ organizationId })}::jsonb`,
      ),
    )
    .orderBy(apikey.createdAt);

  return rows.map((row) => ({
    id: row.id,
    organizationId,
    name: row.name ?? "Unnamed API key",
    prefix: row.prefix ?? "",
    start: row.start ?? "",
    permissions: parsePermissions(row.permissions),
    lastUsedAt: formatDate(row.lastRequest),
    expiresAt: formatDate(row.expiresAt),
    status: apiKeyStatus(row.enabled, row.expiresAt),
    userName: undefined,
    userEmail: undefined,
  }));
}

export { listOrgApiKeys, organizationDesktopAccessConfigId };
