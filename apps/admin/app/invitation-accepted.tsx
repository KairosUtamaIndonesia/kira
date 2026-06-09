import { createFileRoute } from "@tanstack/react-router";

import { SignOutButton } from "@/features/auth/components/SignOutButton";

export const Route = createFileRoute("/invitation-accepted")({
  component: InvitationAcceptedPage,
});

function InvitationAcceptedPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-xs">
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Kira Access
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Invitation accepted</h1>
          <p className="text-sm text-muted-foreground">
            Your organization membership is active. The hosted admin dashboard is only available to
            platform admins.
          </p>
          <p className="text-sm text-muted-foreground">
            To use Kira, open the desktop app and enter the desktop enrollment code provided by your
            administrator.
          </p>
        </div>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}
