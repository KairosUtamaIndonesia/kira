"use client";

import { Circle, Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { primaryNavigation } from "@/features/admin-shell/navigation";

function AdminHeader() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 lg:hidden"
                  aria-label="Open navigation menu"
                >
                  <Menu className="size-5" aria-hidden="true" />
                </Button>
              }
            />
            <SheetContent side="left" className="w-72 bg-sidebar p-0 text-sidebar-foreground">
              <SheetHeader className="flex h-14 items-center border-b border-sidebar-border px-4">
                <SheetTitle className="font-semibold tracking-tight">Kira Admin</SheetTitle>
              </SheetHeader>
              <nav aria-label="Admin" className="flex flex-col gap-1 p-3">
                {primaryNavigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileNavOpen(false)}
                      className="group flex items-start gap-3 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
                    >
                      <Icon
                        aria-hidden="true"
                        className="mt-0.5 size-4 text-muted-foreground group-hover:text-sidebar-accent-foreground"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{item.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>

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
