import { Wrench } from "lucide-react";

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
  return (
    <article className="rounded-xl border border-border bg-card text-card-foreground">
      <div className="flex items-start gap-3 border-b border-border p-3">
        <div className="rounded-md border border-border p-1.5 text-muted-foreground">
          <Wrench aria-hidden="true" className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{title}</h3>
            {status === undefined ? undefined : <ToolStatusBadge status={status} />}
          </div>
          {command === undefined ? undefined : (
            <p className="truncate font-mono text-xs text-muted-foreground">{command}</p>
          )}
        </div>
      </div>
      <div className="grid gap-2 p-3 text-xs">
        {cwd === undefined ? undefined : <MetadataRow label="cwd" value={cwd} />}
        {exitCode === undefined ? undefined : <MetadataRow label="exit" value={String(exitCode)} />}
        {duration === undefined ? undefined : <MetadataRow label="duration" value={duration} />}
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
    </article>
  );
}

function ToolPayload({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) {
    return;
  }

  return (
    <details className="group rounded-md border border-border p-2">
      <summary className="cursor-pointer font-medium text-muted-foreground group-open:mb-2">
        {label}
      </summary>
      <pre className="max-h-72 overflow-auto rounded-md bg-editor-surface p-2 font-mono text-xs text-foreground">
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

function ToolStatusBadge({ status }: { status: ToolCallStatus }) {
  const className = status === "failed" ? "text-destructive" : "text-muted-foreground";

  return (
    <span className={`rounded-full border border-border px-2 py-0.5 text-xs ${className}`}>
      {status}
    </span>
  );
}

export { AgentThreadToolCall };
