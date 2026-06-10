import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";

import { getOrganizationForPlatform } from "@/features/platform/organizations/data/organizations";
import { requireOrgRole } from "@/lib/auth/guards";

const loadAccessControl = createServerFn()
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }) => {
    await requireOrgRole(organizationId);
    const organization = await getOrganizationForPlatform(organizationId);

    if (organization === undefined) {
      throw notFound();
    }

    return { organization };
  });

export const Route = createFileRoute("/org/$organizationId/access-control")({
  loader: ({ params }) => loadAccessControl({ data: params.organizationId }),
  component: AccessControlPage,
});

function AccessControlPage() {
  const { organization } = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">{organization.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Access Control</h1>
      </div>
      <section className="rounded-xl border border-border bg-card p-6 text-card-foreground">
        <div className="flex items-start gap-4">
          <ShieldCheck className="mt-0.5 size-6 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 className="font-medium">Access Control</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Role permissions are managed by Better Auth and are not editable from the admin panel.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
