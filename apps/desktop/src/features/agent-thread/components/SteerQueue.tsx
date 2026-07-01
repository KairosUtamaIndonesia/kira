import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

type SteerQueueProps = {
  messages: readonly string[];
  onRemove: (index: number) => void;
  onClear: () => void;
};

function SteerQueue({ messages, onRemove, onClear }: SteerQueueProps) {
  if (messages.length === 0) {
    return;
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-muted/30 px-2 py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {messages.length === 1 ? "1 queued steer" : `${messages.length} queued steers`}
          {" \u2014 "}
          <span className="text-muted-foreground/70">sends after response</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Clear queue"
        >
          <X aria-hidden="true" className="size-3" />
        </Button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {/* oxlint-disable-next-line react/no-array-index-key -- append-only list, index is stable */}
        {messages.map((msg, i) => (
          <li key={`steer-${i}-${msg.slice(0, 20)}`} className="flex items-start gap-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground italic">{msg}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onRemove(i)}
              className="shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`Remove queued steer ${i + 1}`}
            >
              <X aria-hidden="true" className="size-3" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { SteerQueue };
