import { FileDown } from "lucide-react";

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

function AgentThreadToolWrite({ tool }: Props) {
  const filePath = filePathFromTool(tool);
  const size = sizeFromTool(tool);
  const content = contentFromTool(tool);

  return (
    <div>
      {content === undefined ? (
        <ToolInlineRow
          icon={<FileDown aria-hidden="true" className="size-3" />}
          label={<span className="truncate">Wrote {filePath ?? tool.title}</span>}
        >
          {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
          {size === undefined ? undefined : (
            <span className="shrink-0 text-xs text-muted-foreground/60">{size}</span>
          )}
          <ToolDuration duration={tool.duration} />
        </ToolInlineRow>
      ) : (
        <ToolExpandable
          summary="Show content"
          trigger={
            <ToolInlineRow
              icon={<FileDown aria-hidden="true" className="size-3" />}
              label={<span className="truncate">Wrote {filePath ?? tool.title}</span>}
            >
              {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
              {size === undefined ? undefined : (
                <span className="shrink-0 text-xs text-muted-foreground/60">{size}</span>
              )}
              <ToolDuration duration={tool.duration} />
            </ToolInlineRow>
          }
        >
          <ToolCodeBlock content={content} />
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

function sizeFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.output !== undefined && typeof tool.output === "object" && tool.output !== null) {
    const output = tool.output as Record<string, unknown>;
    if (typeof output.details === "object" && output.details !== null) {
      const details = output.details as Record<string, unknown>;
      if (typeof details.size === "number") {
        return formatFileSize(details.size);
      }
    }
  }

  return;
}

function contentFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.content === "string") {
      return input.content;
    }
  }

  return;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

export { AgentThreadToolWrite };
