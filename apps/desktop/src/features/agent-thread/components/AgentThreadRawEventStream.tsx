import type { PiTranscriptState } from "../types";

import { stringifyUnknown } from "../agentThreadDisplay";

type AgentThreadRawEventStreamProps = {
  transcript: PiTranscriptState;
};

function AgentThreadRawEventStream({ transcript }: AgentThreadRawEventStreamProps) {
  const entries = [
    ...transcript.persistedMessages.map((message, index) => ({
      id: `message:${index}`,
      kind: "message",
      createdAt: timestampFromRecord(message),
      value: message,
    })),
    ...transcript.liveEvents.map((event, index) => ({
      id: `event:${index}`,
      kind: "event",
      createdAt: timestampFromRecord(event),
      value: event,
    })),
  ];

  if (entries.length === 0) {
    return <></>;
  }

  return (
    <section
      className="mt-4 space-y-3 border-t border-border pt-4"
      aria-labelledby="raw-events-title"
    >
      <div>
        <h2 id="raw-events-title" className="text-sm font-medium">
          Raw Pi transcript
        </h2>
        <p className="text-xs text-muted-foreground">
          Persisted Pi messages and live Pi events for this Agent Thread.
        </p>
      </div>
      <ol className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              <span>{formatTimestamp(entry.createdAt)}</span>
              <span>{entry.kind}</span>
            </div>
            <pre className="max-h-80 overflow-auto rounded-md border border-border bg-card p-2 font-mono text-xs text-card-foreground">
              {stringifyUnknown(entry.value)}
            </pre>
          </li>
        ))}
      </ol>
    </section>
  );
}

function timestampFromRecord(record: Record<string, unknown>) {
  const timestamp = record.timestamp;
  if (typeof timestamp === "string") {
    return timestamp;
  }
  if (typeof timestamp === "number") {
    return new Date(timestamp).toISOString();
  }
  return new Date().toISOString();
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export { AgentThreadRawEventStream };
