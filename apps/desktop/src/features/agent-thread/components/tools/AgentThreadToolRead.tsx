import { FileText } from "lucide-react";

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

function AgentThreadToolRead({ tool }: Props) {
  const filePath = filePathFromTool(tool);
  const lineCount = lineCountFromTool(tool);
  const outputText = outputTextFromTool(tool);

  return (
    <div>
      {outputText === undefined ? (
        <ToolInlineRow
          icon={<FileText aria-hidden="true" className="size-3" />}
          label={<span className="truncate">Read {filePath ?? tool.title}</span>}
        >
          {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
          {lineCount === undefined ? undefined : (
            <span className="shrink-0 text-xs text-muted-foreground/60">{lineCount}</span>
          )}
          <ToolDuration duration={tool.duration} />
        </ToolInlineRow>
      ) : (
        <ToolExpandable
          summary="Show content"
          trigger={
            <ToolInlineRow
              icon={<FileText aria-hidden="true" className="size-3" />}
              label={<span className="truncate">Read {filePath ?? tool.title}</span>}
            >
              {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
              {lineCount === undefined ? undefined : (
                <span className="shrink-0 text-xs text-muted-foreground/60">{lineCount}</span>
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

function filePathFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.path === "string") {
      return input.path;
    }
  }

  return;
}

function lineCountFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.output !== undefined && typeof tool.output === "object" && tool.output !== null) {
    const output = tool.output as Record<string, unknown>;
    if (typeof output.details === "object" && output.details !== null) {
      const details = output.details as Record<string, unknown>;
      if (typeof details.lines === "number") {
        return `${details.lines} lines`;
      }
    }
  }

  return;
}

function outputTextFromTool(tool: AgentThreadToolCallDisplay) {
  if (typeof tool.output === "string") {
    return tool.output;
  }

  if (tool.output !== undefined && typeof tool.output === "object" && tool.output !== null) {
    const output = tool.output as Record<string, unknown>;
    if (typeof output.text === "string") {
      return output.text;
    }

    if (Array.isArray(output.content)) {
      const textParts = output.content
        .filter(
          (content): content is { type: "text"; text: string } =>
            typeof content === "object" &&
            content !== null &&
            content.type === "text" &&
            typeof content.text === "string",
        )
        .map((content) => content.text);
      return textParts.join("\n");
    }
  }

  return;
}

export { AgentThreadToolRead };
