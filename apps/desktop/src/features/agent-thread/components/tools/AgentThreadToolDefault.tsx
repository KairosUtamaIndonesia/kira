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
      {tool.command === undefined && tool.exitCode === undefined && tool.cwd === undefined ? (
        <ToolInlineRow
          icon={<Wrench aria-hidden="true" className="size-3" />}
          label={<span className="truncate">Called {tool.title}</span>}
        >
          {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
          <ToolDuration duration={tool.duration} />
        </ToolInlineRow>
      ) : (
        <ToolExpandable
          summary="Show details"
          trigger={
            <ToolInlineRow
              icon={<Wrench aria-hidden="true" className="size-3" />}
              label={<span className="truncate">Called {tool.title}</span>}
            >
              {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
              <ToolDuration duration={tool.duration} />
            </ToolInlineRow>
          }
        >
          <ToolJsonBlock label="Input" value={tool.input} />
          <ToolJsonBlock label="Output" value={tool.output} />
        </ToolExpandable>
      )}
      {tool.errorMessage === undefined ? undefined : (
        <ToolErrorMessage message={tool.errorMessage} />
      )}
    </div>
  );
}

export { AgentThreadToolDefault };
