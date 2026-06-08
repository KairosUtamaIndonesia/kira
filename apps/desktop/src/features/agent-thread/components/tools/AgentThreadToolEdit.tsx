import { FilePen } from "lucide-react";

import type { AgentThreadToolCallDisplay } from "../../agentThreadDisplay";

import { AgentThreadToolDiff } from "./AgentThreadToolDiff";
import {
  ToolDuration,
  ToolErrorMessage,
  ToolExpandable,
  ToolInlineRow,
  ToolStatusBadge,
} from "./ToolPrimitives";

type Props = {
  tool: AgentThreadToolCallDisplay;
};

function AgentThreadToolEdit({ tool }: Props) {
  const filePath = filePathFromTool(tool);
  const oldText = oldTextFromTool(tool);
  const newText = newTextFromTool(tool);

  return (
    <div>
      {oldText === undefined || newText === undefined ? (
        <ToolInlineRow
          icon={<FilePen aria-hidden="true" className="size-3" />}
          label={<span className="truncate">Edited {filePath ?? tool.title}</span>}
        >
          {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
          <ToolDuration duration={tool.duration} />
        </ToolInlineRow>
      ) : (
        <ToolExpandable
          summary="Show diff"
          trigger={
            <ToolInlineRow
              icon={<FilePen aria-hidden="true" className="size-3" />}
              label={<span className="truncate">Edited {filePath ?? tool.title}</span>}
            >
              {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
              <ToolDuration duration={tool.duration} />
            </ToolInlineRow>
          }
        >
          <AgentThreadToolDiff
            filePath={filePath}
            modelKey={`${tool.id}:${filePath ?? "unknown"}`}
            originalContent={oldText}
            modifiedContent={newText}
          />
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

function oldTextFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.oldText === "string") {
      return input.oldText;
    }
  }

  return;
}

function newTextFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.newText === "string") {
      return input.newText;
    }
  }

  return;
}

export { AgentThreadToolEdit };
