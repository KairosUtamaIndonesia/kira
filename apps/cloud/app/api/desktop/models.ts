import { createFileRoute } from "@tanstack/react-router";

import { userBelongsToOrganization } from "@/features/auth/data/membership";
import { listOrganizationModels } from "@/features/org-admin/models/data/models";
import { auth } from "@/lib/auth/auth";
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
          logger.warn("desktop.models.missing_api_key");
          return Response.json({ error: "Missing API key" }, { status: 401 });
        }

        const verification = await auth.api
          .verifyApiKey({
            body: {
              configId: "organization-desktop-access",
              key: apiKeyHeader,
              permissions: { desktopAccess: ["read"] },
            },
          })
          .catch((error: unknown) => {
            logger.error("desktop.models.verify_api_key_failed", {
              error: String(error),
            });
            throw error;
          });

        if (!verification.valid || verification.key === null) {
          logger.warn("desktop.models.invalid_api_key");
          return Response.json({ error: "Invalid API key" }, { status: 401 });
        }

        const userId = verification.key.referenceId;
        const organizationId = organizationIdFromMetadata(verification.key.metadata);

        if (organizationId === undefined) {
          logger.warn("desktop.models.api_key_not_scoped", { userId });
          return Response.json(
            { error: "API key is not scoped to an organization" },
            {
              status: 401,
            },
          );
        }

        if (!(await userBelongsToOrganization(userId, organizationId))) {
          logger.warn("desktop.models.user_not_member", {
            userId,
            organizationId,
          });
          return Response.json(
            { error: "API key user is not a member of the organization" },
            {
              status: 403,
            },
          );
        }

        const models = await listOrganizationModels(organizationId);

        if (models.length === 0) {
          logger.info("desktop.models.none_configured", { organizationId });
          return Response.json(
            { error: "No models configured for this organization" },
            { status: 404 },
          );
        }

        return Response.json({
          models: models.map((model) => ({
            label: model.label,
            upstreamModelId: model.upstreamModelId,
            providerId: model.providerId,
            providerBaseUrl: model.providerBaseUrl,
            contextWindow: model.contextWindow,
            maxOutputTokens: model.maxOutputTokens,
            isDefault: model.isDefault,
            apiKey: model.apiKey,
          })),
        });
      },
    },
  },
});
