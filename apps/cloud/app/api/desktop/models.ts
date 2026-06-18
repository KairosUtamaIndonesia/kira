import { createFileRoute } from "@tanstack/react-router";

import { userBelongsToOrganization } from "@/features/auth/data/membership";
import { listOrganizationModels } from "@/features/org-admin/models/data/models";
import { auth } from "@/lib/auth/auth";

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
          return Response.json({ error: "Missing API key" }, { status: 401 });
        }

        const verification = await auth.api.verifyApiKey({
          body: {
            configId: "organization-desktop-access",
            key: apiKeyHeader,
            permissions: { desktopAccess: ["read"] },
          },
        });

        if (!verification.valid || verification.key === null) {
          return Response.json({ error: "Invalid API key" }, { status: 401 });
        }

        const userId = verification.key.referenceId;
        const organizationId = organizationIdFromMetadata(verification.key.metadata);

        if (organizationId === undefined) {
          return Response.json(
            { error: "API key is not scoped to an organization" },
            {
              status: 401,
            },
          );
        }

        if (!(await userBelongsToOrganization(userId, organizationId))) {
          return Response.json(
            { error: "API key user is not a member of the organization" },
            {
              status: 403,
            },
          );
        }

        const models = await listOrganizationModels(organizationId);

        if (models.length === 0) {
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
