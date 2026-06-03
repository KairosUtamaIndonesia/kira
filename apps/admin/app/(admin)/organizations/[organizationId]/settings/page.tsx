import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { OrganizationHeader } from "@/features/organizations/components/OrganizationHeader";
import { OrganizationSettingsForms } from "@/features/organizations/components/OrganizationSettingsForms";
import {
  getActiveOrganizationIdForCurrentSession,
  getOrganizationForAdmin,
} from "@/features/organizations/data/organizations";
import { getOrganizationSsoConnection } from "@/features/sso/data/ssoConnections";
import { auth } from "@/lib/auth/auth";

type OrganizationSettingsPageProperties = {
  params: Promise<{ organizationId: string }>;
};

export default async function OrganizationSettingsPage({
  params,
}: OrganizationSettingsPageProperties) {
  const { organizationId } = await params;
  const organization = await getOrganizationForAdmin(organizationId);

  if (organization === undefined) {
    notFound();
  }

  const [currentSession, ssoConnection] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    getOrganizationSsoConnection(organization.id),
  ]);
  let activeOrganizationId: string | undefined;

  if (currentSession !== null) {
    activeOrganizationId = await getActiveOrganizationIdForCurrentSession(
      currentSession.session.id,
    );
  }

  return (
    <div className="space-y-6">
      <OrganizationHeader organization={organization} />
      <OrganizationSettingsForms
        organization={organization}
        isCurrentActiveOrganization={activeOrganizationId === organization.id}
        ssoConnection={ssoConnection}
      />
    </div>
  );
}
