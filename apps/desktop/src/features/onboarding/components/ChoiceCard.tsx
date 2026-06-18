import type { ReactNode } from "react";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

type ChoiceCardProps = {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
};

// Selectable card used by the mode and theme steps. Follows the style guide's
// list-row convention: `data-current` drives the selected border/background,
// focus-visible ring for keyboard users.
function ChoiceCard({ selected, onSelect, icon, title, description }: ChoiceCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-current={selected}
      onClick={onSelect}
      className={cn(
        "group flex flex-col items-start gap-2 rounded-lg border border-border bg-background p-4 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
        "data-[current=true]:border-ring data-[current=true]:bg-accent",
      )}
    >
      <span className="flex w-full items-center justify-between">
        <span className="text-muted-foreground group-data-[current=true]:text-foreground">
          {icon}
        </span>
        <Check
          aria-hidden="true"
          className="size-4 text-primary opacity-0 transition-opacity group-data-[current=true]:opacity-100"
        />
      </span>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

export { ChoiceCard };
