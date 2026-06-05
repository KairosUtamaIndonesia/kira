import { Search } from "lucide-react";

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

function AgentThreadToolGrep({ tool }: Props) {
  const pattern = patternFromTool(tool);
  const matchCount = matchCountFromTool(tool);
  const outputText = outputTextFromTool(tool);

  return (
    <div>
      <ToolInlineRow
        icon={<Search aria-hidden="true" className="size-3" />}
        label={
          <span className="truncate">
            Searched {pattern !== undefined ? `"${pattern}"` : tool.title}
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
      {tool.errorMessage === undefined ? undefined : (
        <ToolErrorMessage message={tool.errorMessage} />
      )}
      {outputText === undefined ? undefined : (
        <ToolExpandable summary="Show results">
          <ToolCodeBlock content={outputText} />
        </ToolExpandable>
      )}
    </div>
  );
}

function patternFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.pattern === "string") {
      return input.pattern;
    }
  }

  return;
}

function matchCountFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.output !== undefined && typeof tool.output === "object" && tool.output !== null) {
    const output = tool.output as Record<string, unknown>;
    if (typeof output.details === "object" && output.details !== null) {
      const details = output.details as Record<string, unknown>;
      if (typeof details.matchCount === "number") {
        return details.matchCount;
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

export { AgentThreadToolGrep };
