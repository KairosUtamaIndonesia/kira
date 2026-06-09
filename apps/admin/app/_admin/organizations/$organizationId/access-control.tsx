import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";

import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import { getOrganizationForAdmin } from "@/features/organizations/data/organizations";

const loadAccessControl = createServerFn()
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }) => {
    const organization = await getOrganizationForAdmin(organizationId);

    if (organization === undefined) {
      throw notFound();
    }

    return { organization };
  });

export const Route = createFileRoute("/_admin/organizations/$organizationId/access-control")({
  loader: ({ params }) => loadAccessControl({ data: params.organizationId }),
  component: AccessControlPage,
});

function AccessControlPage() {
  const { organization } = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />
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
