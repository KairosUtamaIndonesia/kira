import { MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useOpenAgentThreads, type OpenAgentThread } from "@/features/agent-thread";

type AgentThreadPickerProps = {
  onSelect: (threadId: string) => void;
};

// Lists every Agent Thread panel open in the current Session, with its live runtime status.
// Selecting one seeds that thread's Composer with the captured element via the draft store.
function AgentThreadPicker({ onSelect }: AgentThreadPickerProps) {
  const threads = useOpenAgentThreads();

  if (threads.length === 0) {
    return (
      <p className="px-1 py-2 text-sm text-muted-foreground">
        No Agent Threads are open in this Session.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {threads.map((thread) => (
        <li key={thread.threadId}>
          <Button
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-left"
            onClick={() => onSelect(thread.threadId)}
          >
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {runtimeStatusLabel(thread.state)}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function runtimeStatusLabel(state: OpenAgentThread["state"]): string {
  if (state === undefined) {
    return "…";
  }
  switch (state.status) {
    case "starting":
      return "Starting";
    case "connecting":
      return "Connecting";
    case "ready":
      return "Ready";
    case "sending":
      return "Sending";
    case "error":
      return "Error";
    case "stopped":
      return "Stopped";
  }
}

export { AgentThreadPicker };
