import { Network } from "lucide-react";

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

function AgentThreadToolTask({ tool }: Props) {
  const description = descriptionFromTool(tool);
  const agent = agentFromTool(tool);
  const outputText = outputTextFromTool(tool);

  return (
    <div>
      <ToolInlineRow
        icon={<Network aria-hidden="true" className="size-3" />}
        label={
          <span className="truncate">
            Delegated {description !== undefined ? description : tool.title}
          </span>
        }
      >
        {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
        {agent === undefined ? undefined : (
          <span className="shrink-0 rounded-full border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
            {agent}
          </span>
        )}
        <ToolDuration duration={tool.duration} />
      </ToolInlineRow>
      {tool.errorMessage === undefined ? undefined : (
        <ToolErrorMessage message={tool.errorMessage} />
      )}
      {outputText === undefined ? undefined : (
        <ToolExpandable summary="Show result">
          <ToolCodeBlock content={outputText} />
        </ToolExpandable>
      )}
    </div>
  );
}

function agentFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.agent === "string") {
      return input.agent;
    }
  }

  return;
}

function descriptionFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.prompt === "string") {
      return input.prompt;
    }

    if (typeof input.description === "string") {
      return input.description;
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

export { AgentThreadToolTask };
