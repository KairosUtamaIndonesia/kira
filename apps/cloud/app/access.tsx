import { createFileRoute, Link } from "@tanstack/react-router";

import { SignOutButton } from "@/features/auth/components/SignOutButton";

export const Route = createFileRoute("/access")({
  component: AccessPage,
});

// Shown to authenticated members who have no web-panel access (no owner/admin
// role in any organization, and not a platform admin).  Explains what they
// have access to and where to go.
function AccessPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-xs">
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Kira
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Desktop access only</h1>
          <p className="text-sm text-muted-foreground">
            Your account is active, but your role doesn't include access to the Kira web panel. The
            web panel is available to organization owners and admins.
          </p>
          <p className="text-sm text-muted-foreground">
            To use Kira, open the{" "}
            <Link to="/desktop-signin" className="underline underline-offset-4">
              desktop app
            </Link>{" "}
            and sign in with your organization credentials.
          </p>
        </div>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}
