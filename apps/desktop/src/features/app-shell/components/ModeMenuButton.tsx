import { Check, ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { appShellModeLabels, useModeStore, type AppShellMode } from "../state/modeStore";

const appShellModes: AppShellMode[] = ["code", "cowork"];

// Deliberately a menu, not a one-click toggle: switching shells rebuilds the
// whole layout, so a fat-fingered header click must not swap modes.
function ModeMenuButton() {
  const mode = useModeStore((state) => state.mode);
  const setMode = useModeStore((state) => state.setMode);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`App mode: ${appShellModeLabels[mode]}`}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span>{appShellModeLabels[mode]}</span>
        <ChevronDown aria-hidden="true" className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-32">
        {appShellModes.map((menuMode) => (
          <DropdownMenuItem key={menuMode} onClick={() => setMode(menuMode)}>
            <span>{appShellModeLabels[menuMode]}</span>
            {menuMode === mode ? (
              <Check aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
            ) : undefined}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ModeMenuButton };
