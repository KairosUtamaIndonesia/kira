import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { AdminShell } from "@/features/admin-shell/components/AdminShell";
import { getSessionFn } from "@/lib/auth/session";

export const Route = createFileRoute("/_admin")({
  beforeLoad: async () => {
    const session = await getSessionFn();

    if (session === null) {
      throw redirect({ to: "/sign-in" });
    }

    if (session.user.role !== "admin") {
      throw redirect({ to: "/invitation-accepted" });
    }

    return { session };
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
