import { notFound } from "next/navigation";

import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import {
  ModelActions,
  ModelForm,
} from "@/features/organizations/components/OrganizationModelForms";
import { listOrganizationModels } from "@/features/organizations/data/organizationModels";
import { getOrganizationForAdmin } from "@/features/organizations/data/organizations";

type OrganizationModelsPageProperties = {
  params: Promise<{ organizationId: string }>;
};

export default async function OrganizationModelsPage({ params }: OrganizationModelsPageProperties) {
  const { organizationId } = await params;
  const organization = await getOrganizationForAdmin(organizationId);

  if (organization === undefined) {
    notFound();
  }

  const models = await listOrganizationModels(organizationId);

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />

      <div className="space-y-1">
        <h2 className="text-lg font-semibold">AI Models</h2>
        <p className="text-sm text-muted-foreground">
          Organization-specific model configurations for desktop agents.
        </p>
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
