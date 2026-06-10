import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { ConsoleShell } from "@/features/console-shell/components/ConsoleShell";
import { getSessionFn } from "@/lib/auth/session";

export const Route = createFileRoute("/_console")({
  beforeLoad: async ({ location }) => {
    const session = await getSessionFn();

    if (session === null) {
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }

    if (session.user.role !== "admin") {
      throw redirect({ to: "/invitation-accepted" });
    }

    return { session };
  },
  component: ConsoleLayout,
});

function ConsoleLayout() {
  return (
    <ConsoleShell>
      <Outlet />
    </ConsoleShell>
  );
}
