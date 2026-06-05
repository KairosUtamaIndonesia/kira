import { Moon, Sun } from "lucide-react";

import type { AppearanceTheme } from "@/features/settings/types";

import { Button } from "@/components/ui/button";
import { useAppearanceTheme } from "@/features/settings/appearanceTheme";

const themeOptions = [
  {
    value: "light",
    label: "Light",
    description: "Use Kira's light interface colors.",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Use Kira's dark interface colors.",
    icon: Moon,
  },
] as const;

function AppearanceSettings() {
  const {
    agentThreadShowRawEventStream,
    errorMessage,
    setAgentThreadShowRawEventStream,
    setTheme,
    status,
    theme,
  } = useAppearanceTheme();

  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-medium">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the interface theme Kira saves in the Persistence Store.
        </p>
      </div>
      <div className="grid gap-4 p-4">
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Theme</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              This setting applies immediately and persists across launches.
            </p>
          </div>
          <fieldset className="grid gap-2 sm:grid-cols-2" aria-label="Theme">
            {themeOptions.map((option) => {
              const Icon = option.icon;
              const isActive = theme === option.value;

              return (
                <Button
                  key={option.value}
                  type="button"
                  variant={isActive ? "default" : "outline"}
                  className="h-auto justify-start gap-3 p-4 text-left"
                  aria-pressed={isActive}
                  disabled={status === "loading"}
                  onClick={() => {
                    void setTheme(option.value satisfies AppearanceTheme);
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span className="grid gap-1">
                    <span>{option.label}</span>
                    <span className="text-xs font-normal opacity-80">{option.description}</span>
                  </span>
                </Button>
              );
            })}
          </fieldset>
          {status === "error" ? (
            <p className="text-xs text-destructive">Theme persistence failed: {errorMessage}</p>
          ) : undefined}
        </div>
        <div className="border-t border-border pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Agent Threads</h3>
              <p className="text-xs text-muted-foreground">
                Show the raw persisted prompt, event, and result records below Agent Thread
                transcripts.
              </p>
            </div>
            <Button
              type="button"
              variant={agentThreadShowRawEventStream ? "default" : "outline"}
              aria-pressed={agentThreadShowRawEventStream}
              disabled={status === "loading"}
              onClick={() => {
                void setAgentThreadShowRawEventStream(!agentThreadShowRawEventStream);
              }}
            >
              {agentThreadShowRawEventStream ? "Raw stream on" : "Raw stream off"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export { AppearanceSettings };
