import { FolderOpen } from "lucide-react";

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

function AgentThreadToolLs({ tool }: Props) {
  const dirPath = dirPathFromTool(tool);
  const entryCount = entryCountFromTool(tool);
  const outputText = outputTextFromTool(tool);

  return (
    <div>
      {outputText === undefined ? (
        <ToolInlineRow
          icon={<FolderOpen aria-hidden="true" className="size-3" />}
          label={<span className="truncate">Listed {dirPath ?? tool.title}</span>}
        >
          {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
          {entryCount === undefined ? undefined : (
            <span className="shrink-0 text-xs text-muted-foreground/60">
              {entryCount} {entryCount === 1 ? "entry" : "entries"}
            </span>
          )}
          <ToolDuration duration={tool.duration} />
        </ToolInlineRow>
      ) : (
        <ToolExpandable
          summary="Show contents"
          trigger={
            <ToolInlineRow
              icon={<FolderOpen aria-hidden="true" className="size-3" />}
              label={<span className="truncate">Listed {dirPath ?? tool.title}</span>}
            >
              {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
              {entryCount === undefined ? undefined : (
                <span className="shrink-0 text-xs text-muted-foreground/60">
                  {entryCount} {entryCount === 1 ? "entry" : "entries"}
                </span>
              )}
              <ToolDuration duration={tool.duration} />
            </ToolInlineRow>
          }
        >
          <ToolCodeBlock content={outputText} />
        </ToolExpandable>
      )}
      {tool.errorMessage === undefined ? undefined : (
        <ToolErrorMessage message={tool.errorMessage} />
      )}
    </div>
  );
}

function dirPathFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.path === "string") {
      return input.path || ".";
    }

    return ".";
  }

  return;
}

function entryCountFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.output !== undefined && typeof tool.output === "object" && tool.output !== null) {
    const output = tool.output as Record<string, unknown>;
    if (typeof output.details === "object" && output.details !== null) {
      const details = output.details as Record<string, unknown>;
      if (typeof details.entryLimitReached === "number") {
        return details.entryLimitReached;
      }
    }
  }

  if (tool.output !== undefined && typeof tool.output === "object" && tool.output !== null) {
    const output = tool.output as Record<string, unknown>;
    if (Array.isArray(output.content)) {
      const textParts = output.content
        .filter(
          (c): c is { type: "text"; text: string } =>
            typeof c === "object" && c !== null && c.type === "text" && typeof c.text === "string",
        )
        .map((c) => c.text);
      const combined = textParts.join("\n");
      const lines = combined.split("\n").filter((line) => line.length > 0 && !line.startsWith("["));
      return lines.length > 0 ? lines.length : undefined;
    }
  }

  return;
}

function outputTextFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.output !== undefined && typeof tool.output === "object" && tool.output !== null) {
    const output = tool.output as Record<string, unknown>;
    if (Array.isArray(output.content)) {
      const textParts = output.content
        .filter(
          (c): c is { type: "text"; text: string } =>
            typeof c === "object" && c !== null && c.type === "text" && typeof c.text === "string",
        )
        .map((c) => c.text);
      return textParts.join("\n");
    }
  }

  return;
}

export { AgentThreadToolLs };
