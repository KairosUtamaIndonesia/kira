import { useEffect, useState } from "react";

import { Loader2 } from "lucide-react";
import { getCloudConfig } from "@/features/agent-thread/cloudConfig";
import { AppSocketProvider } from "@/features/agent-thread/AppSocketProvider";
import { startAgentRuntime } from "@/features/agent-thread/api/agentRuntimeApi";
import { SignInShell } from "@/features/desktop-auth/components/SignInShell";
import { useZoom } from "@/hooks/useZoom";

import { useModeStore } from "../state/modeStore";
import { AppShell } from "./code/AppShell";
import { CoworkShell } from "./cowork/CoworkShell";

/** Whether the user is signed in and cloud config is reachable. */
type CloudAuthState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

function Shell() {
  useZoom();

  const mode = useModeStore((state) => state.mode);
  const [cloudAuth, setCloudAuth] = useState<CloudAuthState>({ status: "loading" });

  useEffect(() => {
    async function init() {
      try {
        // Validate cloud config before starting anything (cached for thread panels)
        await getCloudConfig();
        await startAgentRuntime();
        setCloudAuth({ status: "ready" });
      } catch (error) {
        // Tauri v2 throws the serialized Rust error directly — it's an object
        // like { ConfigMissing: "message" }
        let msg: string;
        if (typeof error === "string") {
          msg = error;
        } else if (error instanceof Error) {
          msg = error.message;
        } else {
          const obj = error as Record<string, unknown>;
          // Rip variant: the Rust enum serializes as { "VariantName": "inner" }
          const values = Object.values(obj);
          msg = values.length > 0 && typeof values[0] === "string" ? values[0] : String(obj);
        }
        setCloudAuth({ status: "error", message: msg });
      }
    }
    void init();
  }, []);

  if (cloudAuth.status === "loading") {
    return (
      <SignInShell>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Connecting to Kira Cloud…
        </div>
      </SignInShell>
    );
  }

  if (cloudAuth.status === "error") {
    return (
      <SignInShell>
        <header className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Kira Desktop
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Cannot connect to Kira Cloud</h1>
          <p className="text-sm text-muted-foreground">
            {cloudAuth.message}
          </p>
        </header>
        <p className="text-xs text-muted-foreground">
          Sign in to Kira Cloud to use the agent runtime. If you are signed in, check your
          network connection and try again.
        </p>
      </SignInShell>
    );
  }

  const inner = mode === "code" ? <AppShell /> : <CoworkShell />;

  return <AppSocketProvider>{inner}</AppSocketProvider>;
}

export { Shell };
