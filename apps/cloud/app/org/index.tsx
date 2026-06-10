import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { resolvePostAuthDestination } from "@/features/auth/data/postAuthDestination";

export const Route = createFileRoute("/org/")({
  loader: async () => {
    const destination = await resolvePostAuthDestination();

    // If they only have one org (or are a platform admin / plain member) send
    // them straight to the right place — no reason to show a picker.
    switch (destination.kind) {
      case "console":
        throw redirect({ to: "/dashboard" });
      case "org":
        throw redirect({
          to: "/org/$organizationId",
          params: { organizationId: destination.organizationId },
        });
      case "member-only":
        throw redirect({ to: "/access" });
      case "org-picker":
        return { organizations: destination.organizations };
    }
  },
  component: OrgPickerPage,
});

function OrgPickerPage() {
  const { organizations } = Route.useLoaderData();

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-xs">
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Kira
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Select an organization</h1>
          <p className="text-sm text-muted-foreground">
            You're an admin of multiple organizations. Choose one to continue.
          </p>
        </div>
        <ul className="mt-6 space-y-2">
          {organizations.map((org) => (
            <li key={org.id}>
              <Link
                to="/org/$organizationId"
                params={{ organizationId: org.id }}
                className="flex w-full items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {org.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
