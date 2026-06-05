import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

import type { ToolCallStatus } from "../agentThreadDisplay";

import { stringifyUnknown } from "../agentThreadDisplay";

type AgentThreadToolCallProps = {
  title: string;
  status: ToolCallStatus | undefined;
  command: string | undefined;
  cwd: string | undefined;
  exitCode: number | undefined;
  duration: string | undefined;
  changedFiles: string[];
  errorMessage: string | undefined;
  input: unknown;
  output: unknown;
};

function AgentThreadToolCall({
  changedFiles,
  command,
  cwd,
  duration,
  errorMessage,
  exitCode,
  input,
  output,
  status,
  title,
}: AgentThreadToolCallProps) {
  const summary = toolSummary(title, command);

  return (
    <article className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-2 text-card-foreground">
      <div className="flex justify-center pt-0.5 text-muted-foreground">
        <ToolStatusIcon status={status} />
      </div>
      <div className="min-w-0 space-y-2 rounded-lg border border-border bg-card p-2.5">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-sm font-medium">{summary}</h3>
            {status === undefined ? undefined : <ToolStatusBadge status={status} />}
            {duration === undefined ? undefined : (
              <span className="text-xs text-muted-foreground">{duration}</span>
            )}
          </div>
          {command === undefined ? undefined : (
            <p className="truncate font-mono text-xs text-muted-foreground">{command}</p>
          )}
        </div>
        <div className="grid gap-2 text-xs">
          {cwd === undefined ? undefined : <MetadataRow label="cwd" value={cwd} />}
          {exitCode === undefined ? undefined : <MetadataRow label="exit" value={String(exitCode)} />}
          {errorMessage === undefined ? undefined : (
            <p className="rounded-md border border-border p-2 text-destructive">{errorMessage}</p>
          )}
          {changedFiles.length === 0 ? undefined : (
            <div className="space-y-1">
              <div className="font-medium text-muted-foreground">Changed files</div>
              <ul className="space-y-1">
                {changedFiles.map((file) => (
                  <li key={file} className="truncate font-mono text-muted-foreground">
                    {file}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ToolPayload label="Input" value={input} />
          <ToolPayload label="Output" value={output} />
        </div>
      </div>
    </article>
  );
}

function toolSummary(title: string, command: string | undefined) {
  if (command !== undefined) {
    return `${toolVerb(title)} command`;
  }

  return toolVerb(title);
}

function toolVerb(title: string) {
  if (title === "read") {
    return "Read file";
  }

  if (title === "write") {
    return "Write file";
  }

  if (title === "edit") {
    return "Edit file";
  }

  if (title === "bash") {
    return "Run command";
  }

  return title;
}

function ToolPayload({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) {
    return;
  }

  return (
    <details className="group min-w-0 rounded-md border border-border p-2">
      <summary className="cursor-pointer font-medium text-muted-foreground group-open:mb-2">
        {label}
      </summary>
      <pre className="max-h-72 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-md bg-editor-surface p-2 font-mono text-xs text-foreground">
        {stringifyUnknown(value)}
      </pre>
    </details>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </div>
  );
}

function ToolStatusIcon({ status }: { status: ToolCallStatus | undefined }) {
  if (status === "running" || status === "queued") {
    return <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />;
  }

  if (status === "succeeded") {
    return <CheckCircle2 aria-hidden="true" className="size-3.5" />;
  }

  if (status === "failed" || status === "canceled") {
    return <XCircle aria-hidden="true" className="size-3.5 text-destructive" />;
  }

  return <Circle aria-hidden="true" className="size-3.5" />;
}

function ToolStatusBadge({ status }: { status: ToolCallStatus }) {
  const className = status === "failed" ? "text-destructive" : "text-muted-foreground";

  return (
    <span className={`rounded-full border border-border px-2 py-0.5 text-xs ${className}`}>
      {status}
    </span>
  );
}

export { AgentThreadToolCall };
