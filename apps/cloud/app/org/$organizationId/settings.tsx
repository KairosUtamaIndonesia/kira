import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getActiveOrganizationIdForCurrentSession } from "@/features/auth/data/membership";
import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import { OrganizationSettingsForms } from "@/features/organizations/components/OrganizationSettingsForms";
import { getOrganizationForPlatform } from "@/features/platform/organizations/data/organizations";
import { getOrganizationSsoConnection } from "@/features/sso/data/ssoConnections";
import { auth } from "@/lib/auth/auth";
import { requireOrgRole } from "@/lib/auth/guards";

const loadOrganizationSettings = createServerFn()
  .validator((organizationId: string) => organizationId)
  .handler(async ({ data: organizationId }) => {
    await requireOrgRole(organizationId);
    const organization = await getOrganizationForPlatform(organizationId);

    if (organization === undefined) {
      throw notFound();
    }

    const [currentSession, ssoConnection] = await Promise.all([
      auth.api.getSession({ headers: getRequest().headers }),
      getOrganizationSsoConnection(organization.id),
    ]);
    let activeOrganizationId: string | undefined;

    if (currentSession !== null) {
      activeOrganizationId = await getActiveOrganizationIdForCurrentSession(
        currentSession.session.id,
      );
    }

    return {
      organization,
      isCurrentActiveOrganization: activeOrganizationId === organization.id,
      ssoConnection,
    };
  });

export const Route = createFileRoute("/org/$organizationId/settings")({
  loader: ({ params }) => loadOrganizationSettings({ data: params.organizationId }),
  component: OrganizationSettingsPage,
});

function OrganizationSettingsPage() {
  const { organization, isCurrentActiveOrganization, ssoConnection } = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />
      <OrganizationSettingsForms
        organization={organization}
        isCurrentActiveOrganization={isCurrentActiveOrganization}
        ssoConnection={ssoConnection}
      />
    </div>
  );
}
