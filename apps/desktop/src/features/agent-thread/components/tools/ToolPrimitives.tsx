import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { ToolCallStatus } from "../../agentThreadDisplay";

import { stringifyUnknown } from "../../agentThreadDisplay";

function ToolInlineRow({
  children,
  icon,
  label,
  labelWrap = false,
}: {
  children?: ReactNode;
  icon: ReactNode;
  label: ReactNode;
  labelWrap?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span
        className={`min-w-0 font-mono text-muted-foreground ${
          labelWrap ? "break-words whitespace-normal" : "truncate"
        }`}
      >
        {label}
      </span>
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
    return <span className="shrink-0 animate-pulse text-xs text-muted-foreground">⋯</span>;
  }

  return <span className="shrink-0 text-xs text-muted-foreground">◦</span>;
}

function ToolExpandable({
  children,
  summary,
  trigger,
}: {
  children: ReactNode;
  summary: string;
  trigger: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button
        aria-expanded={isOpen}
        className="flex max-w-full min-w-0 cursor-pointer items-center text-left"
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        <div className="min-w-0">{trigger}</div>
        <span className="ml-1 shrink-0 text-muted-foreground" title={summary}>
          <ChevronRight
            aria-hidden="true"
            className={`size-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
          />
        </span>
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-150 ease-out ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-1 rounded-md border border-border bg-card/60 p-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ToolCodeBlock({ content }: { content: string }) {
  return (
    <pre className="max-h-72 min-w-0 overflow-auto rounded-md bg-editor-surface p-2 font-mono text-xs break-words whitespace-pre-wrap text-foreground">
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
      <pre className="max-h-72 min-w-0 overflow-auto rounded-md bg-editor-surface p-2 font-mono text-xs break-words whitespace-pre-wrap text-foreground">
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
