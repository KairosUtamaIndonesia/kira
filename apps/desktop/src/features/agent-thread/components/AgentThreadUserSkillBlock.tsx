import { Zap } from "lucide-react";

import { ToolCodeBlock, ToolExpandable, ToolInlineRow } from "./tools/ToolPrimitives";

type Props = {
  block: { type: "skill"; name: string; location: string | undefined; body: string };
};

/**
 * Render one `<skill>` expansion in a user message as a collapsible chip that
 * matches the visual treatment of other tool-call components. Collapsed by
 * default — the user can open it to inspect the skill body.
 */
function AgentThreadUserSkillBlock({ block }: Props) {
  return (
    <ToolExpandable
      summary="Show skill body"
      trigger={
        <ToolInlineRow
          icon={<Zap aria-hidden="true" className="size-3" />}
          label={
            <span className="truncate">
              {block.name}
              <span className="ml-2 text-xs text-muted-foreground">(skill)</span>
            </span>
          }
        >
          {block.location === undefined ? undefined : (
            <span className="ml-1 truncate text-xs text-muted-foreground/60">{block.location}</span>
          )}
        </ToolInlineRow>
      }
    >
      <ToolCodeBlock content={block.body} />
    </ToolExpandable>
  );
}

export { AgentThreadUserSkillBlock };
