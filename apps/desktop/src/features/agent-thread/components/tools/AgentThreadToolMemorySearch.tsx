import { ScanSearch } from "lucide-react";

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

function AgentThreadToolMemorySearch({ tool }: Props) {
  const query = queryFromTool(tool);
  const matchCount = matchCountFromTool(tool);
  const outputText = outputTextFromTool(tool);

  return (
    <div>
      {outputText === undefined ? (
        <ToolInlineRow
          icon={<ScanSearch aria-hidden="true" className="size-3" />}
          label={
            <span className="truncate">
              Searched memory {query !== undefined ? `"${query}"` : ""}
            </span>
          }
        >
          {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
          {matchCount === undefined ? undefined : (
            <span className="shrink-0 text-xs text-muted-foreground/60">
              {matchCount} {matchCount === 1 ? "match" : "matches"}
            </span>
          )}
          <ToolDuration duration={tool.duration} />
        </ToolInlineRow>
      ) : (
        <ToolExpandable
          summary="Show results"
          trigger={
            <ToolInlineRow
              icon={<ScanSearch aria-hidden="true" className="size-3" />}
              label={
                <span className="truncate">
                  Searched memory {query !== undefined ? `"${query}"` : ""}
                </span>
              }
            >
              {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
              {matchCount === undefined ? undefined : (
                <span className="shrink-0 text-xs text-muted-foreground/60">
                  {matchCount} {matchCount === 1 ? "match" : "matches"}
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

function queryFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.query === "string") {
      return input.query;
    }
  }

  return;
}

function matchCountFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.output !== undefined && typeof tool.output === "object" && tool.output !== null) {
    const output = tool.output as Record<string, unknown>;
    if (typeof output.details === "object" && output.details !== null) {
      const details = output.details as Record<string, unknown>;
      if (typeof details.count === "number") {
        return details.count;
      }
    }
  }

  // Fallback: extract count from first line of output text
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
      const match = combined.match(/^Found (\d+) memories? matching/);
      if (match !== null && match[1] !== undefined) {
        return Number.parseInt(match[1], 10);
      }
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

export { AgentThreadToolMemorySearch };
