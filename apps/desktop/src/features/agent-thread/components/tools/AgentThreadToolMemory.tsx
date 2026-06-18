import { Bookmark } from "lucide-react";

import type { AgentThreadToolCallDisplay } from "../../agentThreadDisplay";

import {
  ToolCodeBlock,
  ToolDuration,
  ToolErrorMessage,
  ToolExpandable,
  ToolInlineRow,
  ToolStatusBadge,
} from "./ToolPrimitives";

type Props = {
  tool: AgentThreadToolCallDisplay;
};

type MemoryOutput = {
  success?: boolean;
  error?: string;
  message?: string;
  evicted_entries?: string[];
  warning?: string;
  warnings?: string[];
  usage?: string;
};

function AgentThreadToolMemory({ tool }: Props) {
  const action = actionFromTool(tool);
  const target = targetFromTool(tool);
  const content = contentFromTool(tool);
  const oldText = oldTextFromTool(tool);
  const output = outputRecordFromTool(tool);
  const hasDetails =
    (output !== undefined && output.evicted_entries !== undefined) ||
    (output !== undefined && output.warnings !== undefined) ||
    (output !== undefined && output.error !== undefined);

  return (
    <div>
      <ToolInlineRow
        icon={<Bookmark aria-hidden="true" className="size-3" />}
        label={
          <span className="truncate">
            {actionLabel(action, target)} {content ?? tool.title}
          </span>
        }
      >
        {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
        {output !== undefined && output.usage !== undefined ? (
          <span className="shrink-0 text-xs text-muted-foreground/60">{output.usage}</span>
        ) : undefined}
        <ToolDuration duration={tool.duration} />
      </ToolInlineRow>

      {hasDetails || (output !== undefined && output.message !== undefined) ? (
        <ToolExpandable
          summary="Show details"
          trigger={
            <ToolInlineRow
              icon={<Bookmark aria-hidden="true" className="size-3" />}
              label={
                <span className="truncate">
                  {actionLabel(action, target)} {content ?? tool.title}
                </span>
              }
            >
              {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
              <ToolDuration duration={tool.duration} />
            </ToolInlineRow>
          }
        >
          {oldText === undefined ? undefined : <ToolCodeBlock content={oldText} />}
          {content === undefined ? undefined : <ToolCodeBlock content={content} />}
          {output !== undefined && output.message !== undefined ? (
            <p className="mb-1 font-mono text-xs text-muted-foreground">{output.message}</p>
          ) : undefined}
          {output !== undefined &&
          output.evicted_entries !== undefined &&
          output.evicted_entries.length > 0 ? (
            <div className="mb-1">
              <p className="font-mono text-xs text-muted-foreground/60">
                Rotated {output.evicted_entries.length}{" "}
                {output.evicted_entries.length === 1 ? "entry" : "entries"}:
              </p>
              <ToolCodeBlock content={output.evicted_entries.join("\n")} />
            </div>
          ) : undefined}
          {output !== undefined && output.warnings !== undefined && output.warnings.length > 0 ? (
            <div className="mb-1 space-y-0.5">
              {output.warnings.map((w) => (
                <p key={w} className="font-mono text-xs text-amber-600/80 dark:text-amber-400/80">
                  ⚠ {w}
                </p>
              ))}
            </div>
          ) : undefined}
        </ToolExpandable>
      ) : undefined}

      {tool.errorMessage === undefined ? undefined : (
        <ToolErrorMessage message={tool.errorMessage} />
      )}
      {output !== undefined && output.error !== undefined && tool.errorMessage === undefined ? (
        <ToolErrorMessage message={String(output.error)} />
      ) : undefined}
    </div>
  );
}

function actionFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.action === "string") {
      return input.action;
    }
  }

  return;
}

function targetFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.target === "string") {
      return input.target;
    }
  }

  return;
}

function contentFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.content === "string") {
      return truncateContent(input.content);
    }
  }

  return;
}

function oldTextFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.old_text === "string") {
      return input.old_text;
    }
  }

  return;
}

function outputRecordFromTool(tool: AgentThreadToolCallDisplay): MemoryOutput | undefined {
  if (tool.output !== undefined && typeof tool.output === "object" && tool.output !== null) {
    const output = tool.output as Record<string, unknown>;
    const details = output.details;
    if (typeof details === "object" && details !== null) {
      return details as MemoryOutput;
    }
  }

  return;
}

function truncateContent(content: string): string {
  if (content.length <= 120) return content;

  return content.slice(0, 117) + "...";
}

function actionLabel(action: string | undefined, target: string | undefined): string {
  const targetLabel = targetLabelText(target);
  switch (action) {
    case "add":
      return `Saved ${targetLabel}`;
    case "replace":
      return `Updated ${targetLabel}`;
    case "remove":
      return `Removed from ${targetLabel}`;
    default:
      return `Memory ${targetLabel}`;
  }
}

function targetLabelText(target: string | undefined): string {
  switch (target) {
    case "memory":
      return "to memory";
    case "user":
      return "to user profile";
    case "project":
      return "to project memory";
    case "failure":
      return "to failures";
    default:
      return "";
  }
}

export { AgentThreadToolMemory };
