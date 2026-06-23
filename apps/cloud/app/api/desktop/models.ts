import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";

import { userBelongsToOrganization } from "@/features/auth/data/membership";
import { auth } from "@/lib/auth/auth";
import { db } from "@/lib/db/postgres";
import { organizationModels, organizationProviders } from "@/lib/db/schema";
import { logger } from "@/lib/log";

function organizationIdFromMetadata(metadata: unknown): string | undefined {
  let parsed = metadata;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }

  if (parsed === null || typeof parsed !== "object" || !("organizationId" in parsed)) {
    return undefined;
  }

  const { organizationId } = parsed as { organizationId: unknown };
  return typeof organizationId === "string" && organizationId.length > 0
    ? organizationId
    : undefined;
}

export const Route = createFileRoute("/api/desktop/models")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKeyHeader = request.headers.get("x-api-key");

        if (apiKeyHeader === null || apiKeyHeader.length === 0) {
          return Response.json({ error: "Missing x-api-key header", models: [] }, { status: 400 });
        }

        const verification = await auth.api
          .verifyApiKey({ body: { key: apiKeyHeader } })
          .catch((error: unknown) => {
            logger.error("Failed to verify API key", { error: String(error) });
            // oxlint-disable-next-line unicorn/no-null — null explicitly sets SQL column to NULL
            return { valid: false, key: null };
          });

        if (!verification.valid || verification.key === null) {
          return Response.json({ error: "Invalid API key", models: [] }, { status: 401 });
        }

        const userId = verification.key.referenceId;
        const organizationId = organizationIdFromMetadata(verification.key.metadata);

        if (organizationId === undefined) {
          return Response.json(
            { error: "API key metadata is missing organizationId", models: [] },
            { status: 400 },
          );
        }

        if (!(await userBelongsToOrganization(userId, organizationId))) {
          return Response.json(
            { error: "User does not belong to this organization", models: [] },
            { status: 403 },
          );
        }

        // JOIN with organization_providers to resolve credentials from the provider
        // (reference-based resolution — models no longer store providerBaseUrl/apiKey directly).
        // Falls back to model row columns for backward compat with models created before
        // the reference-based approach was introduced.
        const rows = await db
          .select({
            model: organizationModels,
            provider: organizationProviders,
          })
          .from(organizationModels)
          .leftJoin(
            organizationProviders,
            eq(organizationModels.providerConfigId, organizationProviders.id),
          )
          .where(and(eq(organizationModels.organizationId, organizationId)))
          .orderBy(organizationModels.createdAt);

        if (rows.length === 0) {
          return Response.json({ models: [] });
        }

        return Response.json({
          models: rows.map(({ model, provider }) => ({
            label: model.label,
            upstreamModelId: model.upstreamModelId,
            providerId: model.providerId,
            // Resolve baseUrl from the provider row; fall back to the model column
            // for backward compatibility with legacy snapshot records.
            providerBaseUrl:
              (provider !== null ? provider.providerBaseUrl : undefined) ??
              model.providerBaseUrl ??
              "",
            contextWindow: model.contextWindow,
            maxOutputTokens: model.maxOutputTokens,
            maxInputTokens: model.maxInputTokens,
            capabilities: model.capabilities,
            isDefault: model.isDefault,
            // Resolve apiKey from the provider row; fall back to the model column
            // for backward compatibility with legacy snapshot records.
            apiKey: (provider !== null ? provider.apiKey : undefined) ?? model.apiKey ?? undefined,
          })),
        });
      },
    },
  },
});
