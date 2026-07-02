import { stringifyUnknown } from "../agentThreadDisplay";
import type { PiTranscriptState } from "../types";

type Props = { transcript: PiTranscriptState };

function AgentThreadRawEventStream({ transcript }: Props) {
  if (transcript.messages.length === 0) return null;

  return (
    <section className="mt-4 space-y-3 border-t border-border pt-4" aria-labelledby="raw-events-title">
      <h2 id="raw-events-title" className="text-sm font-medium">
        Raw messages
      </h2>
      <ol className="space-y-3">
        {transcript.messages.map((msg, i) => (
          <li key={msg.id ?? i} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              <span>{msg.role}</span>
            </div>
            <pre className="max-h-80 overflow-auto rounded-md border border-border bg-card p-2 font-mono text-xs text-card-foreground">
              {stringifyUnknown(msg)}
            </pre>
          </li>
        ))}
      </ol>
    </section>
  );
}

export { AgentThreadRawEventStream };
