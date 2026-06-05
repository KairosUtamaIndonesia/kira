import { Terminal } from "lucide-react";

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

function AgentThreadToolBash({ tool }: Props) {
  const outputText = outputTextFromTool(tool);
  const exitCode = tool.exitCode;

  return (
    <div>
      <ToolInlineRow
        icon={<Terminal aria-hidden="true" className="size-3" />}
        label={<span className="truncate">Ran {tool.command ?? tool.title}</span>}
      >
        {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
        {exitCode !== undefined && exitCode !== 0 ? (
          <span className="shrink-0 text-xs text-destructive">exit {exitCode}</span>
        ) : undefined}
        <ToolDuration duration={tool.duration} />
      </ToolInlineRow>
      {tool.errorMessage === undefined ? undefined : (
        <ToolErrorMessage message={tool.errorMessage} />
      )}
      {outputText === undefined || outputText.length === 0 ? undefined : (
        <ToolExpandable summary="Show output">
          <ToolCodeBlock content={outputText} />
        </ToolExpandable>
      )}
    </div>
  );
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

export { AgentThreadToolBash };
