import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { ConsoleShell } from "@/features/console-shell/components/ConsoleShell";
import { loadConsoleUser } from "@/features/console-shell/data/consoleUser";
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
  loader: () => loadConsoleUser(),
  component: ConsoleLayout,
});

function ConsoleLayout() {
  const userMenu = Route.useLoaderData();

  return (
    <ConsoleShell userMenu={userMenu}>
      <Outlet />
    </ConsoleShell>
  );
}
