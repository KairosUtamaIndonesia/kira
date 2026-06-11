import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";

export const Route = createFileRoute("/_console/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Admin configuration</p>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </div>
      <section className="rounded-xl border border-border bg-card p-6 text-card-foreground">
        <div className="flex items-start gap-4">
          <Settings className="mt-0.5 size-6 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 className="font-medium">Admin settings</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Admin settings are not yet configurable from the UI.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
