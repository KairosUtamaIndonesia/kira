import Link from "next/link";

import { primaryNavigation } from "../navigation";

function AdminSidebar() {
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
          return (
            <Link
              key={item.href}
              href={item.href}
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
      <div className="border-t border-sidebar-border p-4 text-xs text-muted-foreground">
        Local admin shell. Authentication is added in the next phase.
      </div>
    </aside>
  );
}

export { AdminSidebar };
