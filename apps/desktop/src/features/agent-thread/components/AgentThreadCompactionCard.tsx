import { Minimize2 } from "lucide-react";

import { ToolCodeBlock, ToolExpandable, ToolInlineRow } from "./tools/ToolPrimitives";

type Props = {
  tokensBefore: number;
  summary: string;
};

function AgentThreadCompactionCard({ tokensBefore, summary }: Props) {
  const label = `Compacted from ${tokensBefore.toLocaleString()} tokens`;

  return (
    <div className="rounded-md border border-border/50 bg-card/40 px-2 py-1.5">
      <ToolExpandable
        summary="Show compaction summary"
        trigger={
          <ToolInlineRow
            icon={<Minimize2 aria-hidden="true" className="size-3" />}
            label={
              <span className="text-xs text-muted-foreground">
                {label}
                <span className="ml-2 text-muted-foreground/60">(expand to view)</span>
              </span>
            }
          />
        }
      >
        <ToolCodeBlock content={summary} />
      </ToolExpandable>
    </div>
  );
}

export { AgentThreadCompactionCard };
