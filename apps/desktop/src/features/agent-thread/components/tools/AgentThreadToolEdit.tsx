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
  const hasContent = oldText !== undefined && newText !== undefined;

  const triggerRow = (
    <ToolInlineRow
      icon={<FilePen aria-hidden="true" className="size-3" />}
      label={<span className="truncate">Edited {filePath ?? tool.title}</span>}
    >
      {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
      <ToolDuration duration={tool.duration} />
    </ToolInlineRow>
  );

  if (!hasContent) {
    return (
      <div>
        {triggerRow}
        {tool.errorMessage === undefined ? undefined : (
          <ToolErrorMessage message={tool.errorMessage} />
        )}
      </div>
    );
  }

  return (
    <div>
      <ToolExpandable defaultOpen summary="Show changes" trigger={triggerRow}>
        <AgentThreadToolDiff
          filePath={filePath}
          modelKey={`${tool.id}:${filePath ?? "unknown"}`}
          originalContent={oldText}
          modifiedContent={newText}
        />
      </ToolExpandable>
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
/**
 * Extract oldText from the tool input, handling both the current Pi SDK format
 * (`edits: [{ oldText, newText }]`) and the legacy format (`oldText` at top level).
 */
function oldTextFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;

    // Current Pi SDK format: edits array
    if (Array.isArray(input.edits) && input.edits.length > 0) {
      const firstEdit = input.edits[0];
      if (
        typeof firstEdit === "object" &&
        firstEdit !== null &&
        typeof (firstEdit as Record<string, unknown>).oldText === "string"
      ) {
        return (firstEdit as Record<string, unknown>).oldText as string;
      }
    }

    // Legacy format: oldText at top level
    if (typeof input.oldText === "string") {
      return input.oldText;
    }
  }

  return;
}

/**
 * Extract newText from the tool input, handling both the current Pi SDK format
 * (`edits: [{ oldText, newText }]`) and the legacy format (`newText` at top level).
 */
function newTextFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;

    // Current Pi SDK format: edits array
    if (Array.isArray(input.edits) && input.edits.length > 0) {
      const firstEdit = input.edits[0];
      if (
        typeof firstEdit === "object" &&
        firstEdit !== null &&
        typeof (firstEdit as Record<string, unknown>).newText === "string"
      ) {
        return (firstEdit as Record<string, unknown>).newText as string;
      }
    }

    // Legacy format: newText at top level
    if (typeof input.newText === "string") {
      return input.newText;
    }
  }

  return;
}

export { AgentThreadToolEdit };
