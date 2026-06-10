import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyProperties = {
  children: ReactNode;
  className?: string;
};

function Empty({ children, className }: EmptyProperties) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-6 text-center text-card-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

function EmptyHeader({ children, className }: EmptyProperties) {
  return (
    <div data-slot="empty-header" className={cn("space-y-1", className)}>
      {children}
    </div>
  );
}

function EmptyTitle({ children, className }: EmptyProperties) {
  return (
    <h3 data-slot="empty-title" className={cn("font-medium", className)}>
      {children}
    </h3>
  );
}

function EmptyDescription({ children, className }: EmptyProperties) {
  return (
    <p data-slot="empty-description" className={cn("text-sm text-muted-foreground", className)}>
      {children}
    </p>
  );
}

export { Empty, EmptyDescription, EmptyHeader, EmptyTitle };
