import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, RotateCcw, Terminal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTerminalSettings } from "@/features/settings/terminalSettings";

function TerminalSettings() {
  const { errorMessage, setShellPath, setTerminalShellPath, shellPath, status, terminalShellPath } =
    useTerminalSettings();
  const [isOverrideExpanded, setIsOverrideExpanded] = useState(terminalShellPath !== undefined);

  async function handleBrowsePrimary() {
    const selected = await open({
      title: "Select shell executable",
      multiple: false,
    });
    if (typeof selected === "string") {
      await setShellPath(selected);
    }
  }

  async function handleBrowseOverride() {
    const selected = await open({
      title: "Select terminal shell executable",
      multiple: false,
    });
    if (typeof selected === "string") {
      await setTerminalShellPath(selected);
    }
  }

  const disabled = status === "loading";

  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-medium">Terminal</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the shell used by Pi&apos;s bash tool and terminal tabs.
        </p>
      </div>
      <div className="grid gap-4 p-4">
        {status === "error" && errorMessage !== undefined && (
          <p className="text-sm text-destructive">{errorMessage}</p>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="shell-path">
            Shell path
          </label>
          <p className="text-xs text-muted-foreground">
            Used by Pi&apos;s bash tool and terminal tabs. Leave empty to use the platform default.
          </p>
          <div className="flex gap-2">
            <Input
              disabled={disabled}
              id="shell-path"
              onChange={(event) => void setShellPath(event.target.value || undefined)}
              placeholder={platformDefaultShell()}
              type="text"
              value={shellPath ?? ""}
            />
            <Button
              disabled={disabled}
              onClick={() => void handleBrowsePrimary()}
              variant="outline"
            >
              Browse
            </Button>
            {shellPath !== undefined && (
              <Button
                disabled={disabled}
                onClick={() => void setShellPath(undefined)}
                size="icon"
                variant="ghost"
              >
                <RotateCcw className="size-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <button
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setIsOverrideExpanded(!isOverrideExpanded)}
            type="button"
          >
            {isOverrideExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <Terminal className="size-3.5" />
            Terminal tab override
          </button>

          {isOverrideExpanded && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Use a different shell for terminal tabs only. Pi&apos;s bash tool will still use the
                primary shell path above.
              </p>
              <div className="flex gap-2">
                <Input
                  disabled={disabled}
                  id="terminal-shell-path"
                  onChange={(event) => void setTerminalShellPath(event.target.value || undefined)}
                  placeholder="Same as primary"
                  type="text"
                  value={terminalShellPath ?? ""}
                />
                <Button
                  disabled={disabled}
                  onClick={() => void handleBrowseOverride()}
                  variant="outline"
                >
                  Browse
                </Button>
                {terminalShellPath !== undefined && (
                  <Button
                    disabled={disabled}
                    onClick={() => void setTerminalShellPath(undefined)}
                    size="icon"
                    variant="ghost"
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function platformDefaultShell(): string {
  if (navigator.platform.startsWith("Win")) {
    return "powershell.exe";
  }

  return "/bin/bash";
}

export { TerminalSettings };
