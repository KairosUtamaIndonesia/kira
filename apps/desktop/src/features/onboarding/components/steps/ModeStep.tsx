import { Code, MessageSquare } from "lucide-react";

import { useModeStore } from "@/features/app-shell/state/modeStore";

import { ChoiceCard } from "../ChoiceCard";

// Step 1: pick the default App Shell mode. Selecting persists immediately through
// the existing mode store, so the layout behind the wizard switches live and the
// choice is saved even if the user skips the rest.
function ModeStep() {
  const mode = useModeStore((state) => state.mode);
  const setMode = useModeStore((state) => state.setMode);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ChoiceCard
        selected={mode === "code"}
        onSelect={() => setMode("code")}
        icon={<Code className="size-5" aria-hidden="true" />}
        title="Code"
        description="Developer layout with a sidebar, workspace, and inspector for files, terminals, and parallel sessions."
      />
      <ChoiceCard
        selected={mode === "cowork"}
        onSelect={() => setMode("cowork")}
        icon={<MessageSquare className="size-5" aria-hidden="true" />}
        title="Cowork"
        description="Chat-first layout with a focused conversation surface and projects, like a familiar AI chat app."
      />
    </div>
  );
}

export { ModeStep };
