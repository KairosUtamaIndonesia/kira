import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { OrgAdminShell } from "@/features/org-admin-shell/components/OrgAdminShell";
import { getSessionFn } from "@/lib/auth/session";

export const Route = createFileRoute("/org/$organizationId")({
  beforeLoad: async ({ location }) => {
    const session = await getSessionFn();
    if (session === null) {
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }
    return { session };
  },
  component: OrgAdminLayout,
});

function OrgAdminLayout() {
  return (
    <OrgAdminShell>
      <Outlet />
    </OrgAdminShell>
  );
}
