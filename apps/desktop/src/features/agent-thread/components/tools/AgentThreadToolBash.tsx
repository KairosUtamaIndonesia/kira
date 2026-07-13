import { Terminal } from "lucide-react";

import type { AgentThreadToolCallDisplay } from "../../agentThreadDisplay";

import { ToolCodeBlock, ToolExpandable, ToolInlineRow, ToolStatusBadge } from "./ToolPrimitives";

type Props = {
  tool: AgentThreadToolCallDisplay;
};

function AgentThreadToolBash({ tool }: Props) {
  // tool.input = JSON-stringified args like {"command":"ls -la"}
  // tool.output = accumulated output from tool_execution_update (pi TUI style)
  let command = "";

  if (tool.input) {
    try {
      const parsed = JSON.parse(tool.input);
      if (parsed && typeof parsed.command === "string") command = parsed.command;
    } catch {
      command = tool.input;
    }
  }

  if (!command) command = tool.toolName;
  const hasOutput = tool.output && tool.output.length > 0;

  return (
    <div className="min-w-0">
      {hasOutput ? (
        <ToolExpandable
          summary="Show output"
          trigger={
            <ToolInlineRow
              icon={<Terminal aria-hidden="true" className="size-3" />}
              label={<span>Ran {command}</span>}
              labelWrap
            >
              <ToolStatusBadge status={tool.status} />
            </ToolInlineRow>
          }
        >
          <ToolCodeBlock content={tool.output} />
        </ToolExpandable>
      ) : (
        <ToolInlineRow
          icon={<Terminal aria-hidden="true" className="size-3" />}
          label={<span>Ran {command}</span>}
          labelWrap
        >
          <ToolStatusBadge status={tool.status} />
        </ToolInlineRow>
      )}
    </div>
  );
}

export { AgentThreadToolBash };
