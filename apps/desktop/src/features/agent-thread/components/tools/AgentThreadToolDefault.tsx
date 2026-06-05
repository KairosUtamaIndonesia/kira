import { Wrench } from "lucide-react";

import type { AgentThreadToolCallDisplay } from "../../agentThreadDisplay";

import {
  ToolDuration,
  ToolErrorMessage,
  ToolExpandable,
  ToolInlineRow,
  ToolJsonBlock,
  ToolStatusBadge,
} from "./ToolPrimitives";

type Props = {
  tool: AgentThreadToolCallDisplay;
};

function AgentThreadToolDefault({ tool }: Props) {
  return (
    <div>
      <ToolInlineRow
        icon={<Wrench aria-hidden="true" className="size-3" />}
        label={<span className="truncate">Called {tool.title}</span>}
      >
        {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
        <ToolDuration duration={tool.duration} />
      </ToolInlineRow>
      {tool.errorMessage === undefined ? undefined : (
        <ToolErrorMessage message={tool.errorMessage} />
      )}
      {tool.command !== undefined || tool.exitCode !== undefined || tool.cwd !== undefined ? (
        <ToolExpandable summary="Show details">
          <ToolJsonBlock label="Input" value={tool.input} />
          <ToolJsonBlock label="Output" value={tool.output} />
        </ToolExpandable>
      ) : undefined}
    </div>
  );
}

export { AgentThreadToolDefault };
