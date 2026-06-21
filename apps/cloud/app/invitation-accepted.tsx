import { createFileRoute } from "@tanstack/react-router";

import { SignOutButton } from "@/features/auth/components/SignOutButton";

export const Route = createFileRoute("/invitation-accepted")({
  component: InvitationAcceptedPage,
});

// Shown immediately after a new member accepts an invitation email link.
// Their membership is now active; direct them to the desktop app.
function InvitationAcceptedPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-xs">
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Kira
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">You're in</h1>
          <p className="text-sm text-muted-foreground">
            Your invitation has been accepted and your organization membership is active.
          </p>
          <p className="text-sm text-muted-foreground">
            Open the Kira desktop app to sign in and start using your organization's tools.
          </p>
        </div>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}
