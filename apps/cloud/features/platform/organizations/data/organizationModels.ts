import { and, eq } from "drizzle-orm";

import type { OrganizationModel } from "@/features/organizations/types";
import type {
  CreateOrganizationModelInput,
  UpdateOrganizationModelInput,
} from "@/features/organizations/validation/organizationModel";

import { db } from "@/lib/db/postgres";
import { organizationModels } from "@/lib/db/schema";

function toOrganizationModel(row: typeof organizationModels.$inferSelect): OrganizationModel {
  return {
    id: row.id,
    organizationId: row.organizationId,
    label: row.label,
    upstreamModelId: row.upstreamModelId,
    providerId: row.providerId,
    providerBaseUrl: row.providerBaseUrl ?? undefined,
    // oxlint-disable-next-line zod/required-property — DB column is nullable for legacy rows
    providerConfigId: row.providerConfigId ?? (undefined as unknown as string),
    maxInputTokens: row.maxInputTokens ?? undefined,
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    isDefault: row.isDefault,
    apiKey: row.apiKey ?? undefined,
    capabilities: row.capabilities ?? undefined,
    createdAt: row.createdAt.toISOString().slice(0, 10),
  };
}

async function listOrganizationModels(organizationId: string): Promise<OrganizationModel[]> {
  const rows = await db
    .select()
    .from(organizationModels)
    .where(eq(organizationModels.organizationId, organizationId))
    .orderBy(organizationModels.createdAt);

  return rows.map(toOrganizationModel);
}

async function createOrganizationModel(
  input: CreateOrganizationModelInput,
): Promise<OrganizationModel> {
  return db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx
        .update(organizationModels)
        .set({ isDefault: false })
        .where(eq(organizationModels.organizationId, input.organizationId));
    }

    const [row] = await tx
      .insert(organizationModels)
      .values({
        organizationId: input.organizationId,
        label: input.label,
        upstreamModelId: input.upstreamModelId,
        providerId: input.providerId,
        providerConfigId: input.providerConfigId,
        contextWindow: input.contextWindow,
        maxOutputTokens: input.maxOutputTokens,
        // oxlint-disable-next-line unicorn/no-null — null explicitly sets SQL column to NULL
        maxInputTokens: input.maxInputTokens ?? null,
        isDefault: input.isDefault,
        // oxlint-disable-next-line unicorn/no-null — null explicitly sets SQL column to NULL
        capabilities: input.capabilities ?? null,
      })
      .returning();

    if (row === undefined) {
      throw new Error("Failed to create organization model.");
    }

    return toOrganizationModel(row);
  });
}

async function updateOrganizationModel(
  input: UpdateOrganizationModelInput,
): Promise<OrganizationModel> {
  return db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx
        .update(organizationModels)
        .set({ isDefault: false })
        .where(eq(organizationModels.organizationId, input.organizationId));
    }

    const [row] = await tx
      .update(organizationModels)
      .set({
        label: input.label,
        upstreamModelId: input.upstreamModelId,
        providerId: input.providerId,
        providerConfigId: input.providerConfigId,
        contextWindow: input.contextWindow,
        maxOutputTokens: input.maxOutputTokens,
        // oxlint-disable-next-line unicorn/no-null — null explicitly sets SQL column to NULL
        maxInputTokens: input.maxInputTokens ?? null,
        isDefault: input.isDefault,
        // oxlint-disable-next-line unicorn/no-null — null explicitly sets SQL column to NULL
        capabilities: input.capabilities ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationModels.id, input.modelId),
          eq(organizationModels.organizationId, input.organizationId),
        ),
      )
      .returning();

    if (row === undefined) {
      throw new Error("Organization model was not found.");
    }

    return toOrganizationModel(row);
  });
}

async function deleteOrganizationModel(organizationId: string, modelId: string): Promise<void> {
  await db
    .delete(organizationModels)
    .where(
      and(
        eq(organizationModels.id, modelId),
        eq(organizationModels.organizationId, organizationId),
      ),
    );
}

async function setDefaultOrganizationModel(organizationId: string, modelId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(organizationModels)
      .set({ isDefault: false })
      .where(eq(organizationModels.organizationId, organizationId));

    await tx
      .update(organizationModels)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(
        and(
          eq(organizationModels.id, modelId),
          eq(organizationModels.organizationId, organizationId),
        ),
      );
  });
}

export {
  createOrganizationModel,
  deleteOrganizationModel,
  listOrganizationModels,
  setDefaultOrganizationModel,
  updateOrganizationModel,
};
