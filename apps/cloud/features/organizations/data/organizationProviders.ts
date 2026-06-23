import { and, eq } from "drizzle-orm";

import type {
  OrganizationProvider,
  PublicOrganizationProvider,
} from "@/features/organizations/types";
import type {
  CreateOrganizationProviderInput,
  UpdateOrganizationProviderInput,
} from "@/features/organizations/validation/organizationProvider";

import { db } from "@/lib/db/postgres";
import { organizationProviders } from "@/lib/db/schema";

/** Full mapper — includes apiKey. Used only for single-provider fetch (edit form). */
function toOrganizationProvider(
  row: typeof organizationProviders.$inferSelect,
): OrganizationProvider {
  return {
    id: row.id,
    organizationId: row.organizationId,
    label: row.label,
    providerId: row.providerId,
    providerBaseUrl: row.providerBaseUrl,
    apiKey: row.apiKey ?? undefined,
    modelsEndpoint: row.modelsEndpoint ?? undefined,
    createdAt: row.createdAt.toISOString().slice(0, 10),
  };
}

/** Public mapper — never ships apiKey to the browser. */
function toPublicOrganizationProvider(
  row: typeof organizationProviders.$inferSelect,
): PublicOrganizationProvider {
  return {
    id: row.id,
    organizationId: row.organizationId,
    label: row.label,
    providerId: row.providerId,
    providerBaseUrl: row.providerBaseUrl,
    modelsEndpoint: row.modelsEndpoint ?? undefined,
    createdAt: row.createdAt.toISOString().slice(0, 10),
  };
}

async function listOrganizationProviders(
  organizationId: string,
): Promise<PublicOrganizationProvider[]> {
  const rows = await db
    .select()
    .from(organizationProviders)
    .where(eq(organizationProviders.organizationId, organizationId))
    .orderBy(organizationProviders.createdAt);

  return rows.map(toPublicOrganizationProvider);
}

async function getOrganizationProvider(
  organizationId: string,
  id: string,
): Promise<OrganizationProvider> {
  const [row] = await db
    .select()
    .from(organizationProviders)
    .where(
      and(
        eq(organizationProviders.id, id),
        eq(organizationProviders.organizationId, organizationId),
      ),
    );

  if (row === undefined) {
    throw new Error("Organization provider not found.");
  }

  return toOrganizationProvider(row);
}

async function createOrganizationProvider(
  input: CreateOrganizationProviderInput,
): Promise<OrganizationProvider> {
  const [row] = await db
    .insert(organizationProviders)
    .values({
      organizationId: input.organizationId,
      label: input.label,
      providerId: input.providerId,
      providerBaseUrl: input.providerBaseUrl,
      // oxlint-disable-next-line unicorn/no-null — null explicitly sets SQL column to NULL
      apiKey: input.apiKey ?? null,
      modelsEndpoint: input.modelsEndpoint,
    })
    .returning();

  if (row === undefined) {
    throw new Error("Failed to create organization provider.");
  }

  return toOrganizationProvider(row);
}

async function updateOrganizationProvider(
  input: UpdateOrganizationProviderInput,
): Promise<OrganizationProvider> {
  const [row] = await db
    .update(organizationProviders)
    .set({
      label: input.label,
      providerId: input.providerId,
      providerBaseUrl: input.providerBaseUrl,
      // oxlint-disable-next-line unicorn/no-null — null explicitly sets SQL column to NULL
      apiKey: input.apiKey ?? null,
      modelsEndpoint: input.modelsEndpoint,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(organizationProviders.id, input.id),
        eq(organizationProviders.organizationId, input.organizationId),
      ),
    )
    .returning();

  if (row === undefined) {
    throw new Error("Organization provider was not found.");
  }

  return toOrganizationProvider(row);
}

async function deleteOrganizationProvider(organizationId: string, id: string): Promise<void> {
  await db
    .delete(organizationProviders)
    .where(
      and(
        eq(organizationProviders.id, id),
        eq(organizationProviders.organizationId, organizationId),
      ),
    );
}

export {
  createOrganizationProvider,
  deleteOrganizationProvider,
  getOrganizationProvider,
  listOrganizationProviders,
  updateOrganizationProvider,
};
