import { FilePen } from "lucide-react";

import type { AgentThreadToolCallDisplay } from "../../agentThreadDisplay";

import {
  ToolDuration,
  ToolErrorMessage,
  ToolExpandable,
  ToolInlineRow,
  ToolStatusBadge,
} from "./ToolPrimitives";
import { AgentThreadToolDiff } from "./AgentThreadToolDiff";

type Props = {
  tool: AgentThreadToolCallDisplay;
};

function AgentThreadToolEdit({ tool }: Props) {
  const filePath = filePathFromTool(tool);
  const oldText = oldTextFromTool(tool);
  const newText = newTextFromTool(tool);

  return (
    <div>
      <ToolInlineRow
        icon={<FilePen aria-hidden="true" className="size-3" />}
        label={<span className="truncate">Edited {filePath ?? tool.title}</span>}
      >
        {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
        <ToolDuration duration={tool.duration} />
      </ToolInlineRow>
      {tool.errorMessage === undefined ? undefined : (
        <ToolErrorMessage message={tool.errorMessage} />
      )}
      {oldText !== undefined && newText !== undefined ? (
        <ToolExpandable summary="Show diff">
          <AgentThreadToolDiff
            filePath={filePath}
            modelKey={`${tool.id}:${filePath ?? "unknown"}`}
            originalContent={oldText}
            modifiedContent={newText}
          />
        </ToolExpandable>
      ) : undefined}
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
