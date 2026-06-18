import { Zap } from "lucide-react";

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

function AgentThreadToolSkill({ tool }: Props) {
  const action = actionFromTool(tool);
  const skillName = skillNameFromTool(tool);
  const scope = scopeFromTool(tool);
  const output = outputRecordFromTool(tool);
  const hasDetails = output !== undefined && output.success;

  return (
    <div>
      <ToolInlineRow
        icon={<Zap aria-hidden="true" className="size-3" />}
        label={
          <span className="truncate">
            {actionLabel(action)} {skillName ?? tool.title}
          </span>
        }
      >
        {scope === undefined ? undefined : (
          <span className="shrink-0 rounded-full border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
            {scope}
          </span>
        )}
        {tool.status === undefined ? undefined : <ToolStatusBadge status={tool.status} />}
        <ToolDuration duration={tool.duration} />
      </ToolInlineRow>

      {hasDetails ? (
        <ToolExpandable
          summary="Show skill"
          trigger={
            <ToolInlineRow
              icon={<Zap aria-hidden="true" className="size-3" />}
              label={
                <span className="truncate">
                  {actionLabel(action)} {skillName ?? tool.title}
                </span>
              }
            >
              {scope === undefined ? undefined : (
                <span className="shrink-0 rounded-full border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                  {scope}
                </span>
              )}
              <ToolDuration duration={tool.duration} />
            </ToolInlineRow>
          }
        >
          <ToolJsonBlock label="Result" value={output} />
        </ToolExpandable>
      ) : undefined}

      {tool.errorMessage === undefined ? undefined : (
        <ToolErrorMessage message={tool.errorMessage} />
      )}
      {output !== undefined && output.error !== undefined && tool.errorMessage === undefined ? (
        <ToolErrorMessage message={String(output.error)} />
      ) : undefined}
    </div>
  );
}

function actionFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.action === "string") {
      return input.action;
    }
  }

  return;
}

function skillNameFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.name === "string") {
      return input.name;
    }

    if (typeof input.skill_id === "string") {
      return input.skill_id;
    }
  }

  return;
}

function scopeFromTool(tool: AgentThreadToolCallDisplay) {
  if (tool.input !== undefined && typeof tool.input === "object" && tool.input !== null) {
    const input = tool.input as Record<string, unknown>;
    if (typeof input.scope === "string") {
      return input.scope;
    }
  }

  return;
}

function outputRecordFromTool(
  tool: AgentThreadToolCallDisplay,
): Record<string, unknown> | undefined {
  if (tool.output !== undefined && typeof tool.output === "object" && tool.output !== null) {
    const output = tool.output as Record<string, unknown>;
    const details = output.details;
    if (typeof details === "object" && details !== null) {
      return details as Record<string, unknown>;
    }
  }

  return;
}

function actionLabel(action: string | undefined): string {
  switch (action) {
    case "create":
      return "Created skill";
    case "view":
      return "Viewed skill";
    case "patch":
      return "Patched skill";
    case "update":
    case "edit":
      return "Updated skill";
    case "delete":
      return "Deleted skill";
    default:
      return "Skill";
  }
}

export { AgentThreadToolSkill };
