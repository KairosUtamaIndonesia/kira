import type { ReactNode } from "react";

import type { ToolCallStatus } from "../../agentThreadDisplay";

import { stringifyUnknown } from "../../agentThreadDisplay";

function ToolInlineRow({
  children,
  icon,
  label,
}: {
  children?: ReactNode;
  icon: ReactNode;
  label: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 truncate font-mono text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function ToolStatusBadge({ status }: { status: ToolCallStatus }) {
  if (status === "succeeded") {
    return <span className="shrink-0 text-xs text-muted-foreground">✓</span>;
  }

  if (status === "failed") {
    return <span className="shrink-0 text-xs text-destructive">✗</span>;
  }

  if (status === "running") {
    return <span className="shrink-0 text-xs text-muted-foreground animate-pulse">⋯</span>;
  }

  return <span className="shrink-0 text-xs text-muted-foreground">◦</span>;
}

function ToolExpandable({ children, summary }: { children: ReactNode; summary: ReactNode }) {
  return (
    <details className="group mt-1">
      <summary className="cursor-pointer text-xs text-muted-foreground group-open:mb-2">
        {summary}
      </summary>
      <div className="rounded-md border border-border bg-card/60 p-2">
        {children}
      </div>
    </details>
  );
}

function ToolCodeBlock({ content }: { content: string }) {
  return (
    <pre className="max-h-72 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-md bg-editor-surface p-2 font-mono text-xs text-foreground">
      {content}
    </pre>
  );
}

function ToolJsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) {
    return;
  }

  return (
    <details className="group mb-1 min-w-0">
      <summary className="cursor-pointer font-mono text-xs text-muted-foreground group-open:mb-1">
        {label}
      </summary>
      <pre className="max-h-72 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-md bg-editor-surface p-2 font-mono text-xs text-foreground">
        {stringifyUnknown(value)}
      </pre>
    </details>
  );
}

function ToolDuration({ duration }: { duration: string | undefined }) {
  if (duration === undefined) {
    return;
  }

  return <span className="shrink-0 text-xs text-muted-foreground/60">{duration}</span>;
}

function ToolErrorMessage({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-border p-1.5 font-mono text-xs text-destructive">
      {message}
    </p>
  );
}

export {
  ToolCodeBlock,
  ToolDuration,
  ToolErrorMessage,
  ToolExpandable,
  ToolInlineRow,
  ToolJsonBlock,
  ToolStatusBadge,
};