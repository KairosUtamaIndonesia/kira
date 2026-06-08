"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { primaryNavigation } from "../navigation";

function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:min-h-svh lg:flex-col">
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          Kira Admin
        </Link>
      </div>
      <nav aria-label="Admin" className="flex flex-1 flex-col gap-1 p-3">
        {primaryNavigation.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-start gap-3 rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4",
                  isActive
                    ? "text-sidebar-accent-foreground"
                    : "text-muted-foreground group-hover:text-sidebar-accent-foreground",
                )}
              />
              <span className="min-w-0">
                <span className="block font-medium">{item.label}</span>
                <span
                  className={cn(
                    "block truncate text-xs",
                    isActive ? "text-sidebar-accent-foreground/80" : "text-muted-foreground",
                  )}
                >
                  {item.description}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export { AdminSidebar };
