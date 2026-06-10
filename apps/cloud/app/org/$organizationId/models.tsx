import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { listOrganizationModels } from "@/features/org-admin/models/data/models";
import {
  ModelActions,
  ModelForm,
} from "@/features/organizations/components/OrganizationModelForms";
import { getOrganizationForPlatform } from "@/features/platform/organizations/data/organizations";
import { requireOrgRole } from "@/lib/auth/guards";

const loadModels = createServerFn()
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }) => {
    await requireOrgRole(organizationId);
    const organization = await getOrganizationForPlatform(organizationId);

    if (organization === undefined) {
      throw notFound();
    }

    const models = await listOrganizationModels(organizationId);

    return { organization, models };
  });

export const Route = createFileRoute("/org/$organizationId/models")({
  loader: ({ params }) => loadModels({ data: params.organizationId }),
  component: OrganizationModelsPage,
});

function OrganizationModelsPage() {
  const { organization, models } = Route.useLoaderData();
  const { organizationId } = Route.useParams();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">{organization.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
      </div>

      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="mb-4">
          <h3 className="font-medium">Add model</h3>
          <p className="text-sm text-muted-foreground">
            Register a model the desktop agents can use for this organization.
          </p>
        </div>
        <ModelForm organizationId={organizationId} />
      </section>

      {models.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No models configured yet.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {models.map((model) => (
            <li
              key={model.id}
              className="rounded-xl border border-border bg-card p-4 text-card-foreground"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{model.label}</span>
                  {model.isDefault ? (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Default
                    </span>
                  ) : undefined}
                </div>
                <p className="text-sm text-muted-foreground">{model.upstreamModelId}</p>
                <p className="text-xs text-muted-foreground">
                  {model.providerId} · {model.contextWindow.toLocaleString()} ctx ·{" "}
                  {model.maxOutputTokens.toLocaleString()} out
                </p>
              </div>
              <div className="mt-3">
                <ModelActions model={model} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
