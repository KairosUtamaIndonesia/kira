import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { beginSignin } from "../api/desktopAuthApi";
import { SignInShell } from "./SignInShell";

type SignInScreenProps = {
  onSignedIn: () => void;
};

type SignInPhase =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "error"; message: string };

function describeError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Sign-in could not be completed. Please try again.";
}

function SignInScreen({ onSignedIn }: SignInScreenProps) {
  const [phase, setPhase] = useState<SignInPhase>({ status: "idle" });

  async function handleSignin() {
    setPhase({ status: "connecting" });

    try {
      await beginSignin();
      onSignedIn();
    } catch (error) {
      setPhase({ status: "error", message: describeError(error) });
    }
  }

  return (
    <SignInShell>
      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Kira Desktop
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue</h1>
        <p className="text-sm text-muted-foreground">
          Sign in with your Kira account to load your workspace. Your browser opens to complete
          sign-in, then returns you here automatically.
        </p>
      </header>

      {phase.status === "connecting" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Waiting for sign-in in your browser…
        </div>
      ) : (
        <Button
          size="lg"
          onClick={() => {
            void handleSignin();
          }}
        >
          Sign in
        </Button>
      )}

      {phase.status === "error" ? (
        <p className="text-sm text-destructive">{phase.message}</p>
      ) : undefined}
    </SignInShell>
  );
}

export { SignInScreen };
