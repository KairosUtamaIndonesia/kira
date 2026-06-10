import { useState } from "react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/features/desktop-auth/api/desktopAuthApi";
import { useSigninStatus } from "@/features/desktop-auth/hooks/useSigninStatus";

function GeneralSettings() {
  const status = useSigninStatus();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  async function handleSignOut() {
    setErrorMessage(undefined);
    setIsSigningOut(true);

    try {
      await signOut();
      // The SignInGate re-checks the status on the next render, so a full
      // reload is the cleanest way to drop back to the sign-in screen.
      window.location.reload();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not sign out. Please try again.",
      );
      setIsSigningOut(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-medium">General</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account and the organization this installation is signed in to.
        </p>
      </div>
      <div className="space-y-4 p-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{status === undefined ? "—" : (status.userName ?? "—")}</dd>

          <dt className="text-muted-foreground">Email</dt>
          <dd className="font-medium break-all">
            {status === undefined ? "—" : (status.userEmail ?? "—")}
          </dd>

          <dt className="text-muted-foreground">Organization</dt>
          <dd className="font-medium">
            {status === undefined ? "—" : (status.organizationName ?? "—")}
          </dd>
        </dl>

        <div className="border-t border-border pt-4">
          <Button
            variant="outline"
            disabled={isSigningOut || status === undefined || !status.signedIn}
            onClick={() => {
              void handleSignOut();
            }}
          >
            {isSigningOut ? "Signing out…" : "Log out"}
          </Button>
          {errorMessage === undefined ? undefined : (
            <p className="mt-2 text-sm text-destructive">{errorMessage}</p>
          )}
        </div>
      </div>
    </section>
  );
}

export { GeneralSettings };
