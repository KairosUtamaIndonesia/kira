import { createFileRoute } from "@tanstack/react-router";

import { listOrganizationModels } from "@/features/organizations/data/organizationModels";
import { auth } from "@/lib/auth/auth";

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
            key: apiKeyHeader,
            permissions: { desktopAccess: ["read"] },
          },
        });

        if (!verification.valid || verification.key === null) {
          return Response.json({ error: "Invalid API key" }, { status: 401 });
        }

        const organizationId = verification.key.referenceId;
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
          })),
        });
      },
    },
  },
});
