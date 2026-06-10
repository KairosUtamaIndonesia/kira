import { createFileRoute, redirect } from "@tanstack/react-router";

import { resolvePostAuthDestination } from "@/features/auth/data/postAuthDestination";

export const Route = createFileRoute("/")({
  loader: async () => {
    const destination = await resolvePostAuthDestination();

    switch (destination.kind) {
      case "console":
        throw redirect({ to: "/dashboard" });
      case "org":
        throw redirect({
          to: "/org/$organizationId",
          params: { organizationId: destination.organizationId },
        });
      case "org-picker":
      case "member-only":
        throw redirect({ to: "/invitation-accepted" });
    }
  },
});
