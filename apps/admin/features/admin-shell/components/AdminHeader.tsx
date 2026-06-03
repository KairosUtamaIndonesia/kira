import { Circle } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { primaryNavigation } from "@/features/admin-shell/navigation";

function AdminHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/dashboard" className="font-semibold tracking-tight lg:hidden">
            Kira Admin
          </Link>
          <nav aria-label="Admin sections" className="hidden items-center gap-1 md:flex lg:hidden">
            {primaryNavigation.map((item) => (
              <Button
                key={item.href}
                render={<Link href={item.href} />}
                nativeButton={false}
                variant="ghost"
                size="sm"
              >
                {item.label}
              </Button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
            <Circle aria-hidden="true" className="size-2 fill-current" />
            Local
          </span>
          <Button variant="outline" size="sm">
            User menu
          </Button>
        </div>
      </div>
    </header>
  );
}

export { AdminHeader };
