import { useState, useEffect, useCallback } from "react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/features/desktop-auth/api/desktopAuthApi";
import { useSigninStatus } from "@/features/desktop-auth/hooks/useSigninStatus";
import { useOnboardingStore } from "@/features/onboarding";
import { useAppSocket } from "@/features/agent-thread/AppSocketProvider";

function GeneralSettings() {
  const status = useSigninStatus();
  const restartOnboarding = useOnboardingStore((state) => state.restart);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "done" | "error">("idle");

  const socket = useAppSocket();

  // Listen for model catalog refresh result
  useEffect(() => {
    const unsub = socket.onEvent((event: any) => {
      if (event.type === "model_catalog_refreshed") {
        setRefreshState(event.success ? "done" : "error");
        if (!event.success) setErrorMessage(event.error ?? "Refresh failed");
      }
    });
    return unsub;
  }, [socket]);

  const handleRefresh = useCallback(() => {
    setRefreshState("refreshing");
    setErrorMessage(undefined);
    socket.send({ type: "refresh_model_catalog" });
    // Reset to idle after a few seconds
    setTimeout(() => setRefreshState((s) => (s === "done" ? "idle" : s)), 3000);
  }, [socket]);

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

        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-medium">Welcome guide</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Replay the quick-start setup for mode, notification sound, and theme.
          </p>
          <Button variant="outline" className="mt-3" onClick={restartOnboarding}>
            Replay quick start
          </Button>
        </div>

        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-medium">Model catalog</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Refresh the model list from the cloud. New or updated models will be available immediately.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="outline"
              disabled={refreshState === "refreshing"}
              onClick={handleRefresh}
            >
              {refreshState === "refreshing"
                ? "Refreshing…"
                : refreshState === "done"
                  ? "Refreshed"
                  : "Refresh model catalog"}
            </Button>
            {refreshState === "done" ? (
              <span className="text-sm text-muted-foreground">Models updated</span>
            ) : null}
            {refreshState === "error" ? (
              <span className="text-sm text-destructive">Refresh failed — check connection</span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export { GeneralSettings };
