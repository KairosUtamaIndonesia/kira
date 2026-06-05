import type { AgentThreadMessageRecord } from "../types";

import { stringifyUnknown } from "../agentThreadDisplay";

type AgentThreadRawEventStreamProps = {
  messages: AgentThreadMessageRecord[];
};

function AgentThreadRawEventStream({ messages }: AgentThreadRawEventStreamProps) {
  if (messages.length === 0) {
    return <></>;
  }

  return (
    <section
      className="mt-4 space-y-3 border-t border-border pt-4"
      aria-labelledby="raw-events-title"
    >
      <div>
        <h2 id="raw-events-title" className="text-sm font-medium">
          Raw event stream
        </h2>
        <p className="text-xs text-muted-foreground">
          Persisted Agent Thread prompt, event, and result records.
        </p>
      </div>
      <ol className="space-y-3">
        {messages.map((message) => (
          <li key={message.id} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              <span>{formatTimestamp(message.createdAt)}</span>
              <span>{message.kind}</span>
              <span>{message.requestId}</span>
            </div>
            <pre className="max-h-80 overflow-auto rounded-md border border-border bg-card p-2 font-mono text-xs text-card-foreground">
              {stringifyUnknown(message.message)}
            </pre>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export { AgentThreadRawEventStream };
