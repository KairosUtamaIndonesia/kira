import type { ReactNode } from "react";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { getSigninStatus } from "../api/desktopAuthApi";
import { SignInScreen } from "./SignInScreen";
import { SignInShell } from "./SignInShell";

type SignInGateProps = {
  children: ReactNode;
};

type GateState = "checking" | "signed-out" | "signed-in";

function SignInGate({ children }: SignInGateProps) {
  const [state, setState] = useState<GateState>("checking");

  useEffect(() => {
    let active = true;

    async function checkStatus() {
      try {
        const status = await getSigninStatus();
        if (active) {
          setState(status.signedIn ? "signed-in" : "signed-out");
        }
      } catch {
        // If status cannot be read, require sign-in: the screen surfaces the
        // real error when the user starts the flow.
        if (active) {
          setState("signed-out");
        }
      }
    }

    void checkStatus();

    return () => {
      active = false;
    };
  }, []);

  if (state === "signed-in") {
    return children;
  }

  if (state === "signed-out") {
    return (
      <SignInScreen
        onSignedIn={() => {
          setState("signed-in");
        }}
      />
    );
  }

  return (
    <SignInShell>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Checking sign-in…
      </div>
    </SignInShell>
  );
}

export { SignInGate };
