import type { ActiveWorkspaceState } from "../types";

type AppStatusBarProps = {
  activeWorkspace: ActiveWorkspaceState;
};

function AppStatusBar({ activeWorkspace }: AppStatusBarProps) {
  return (
    <footer className="flex items-center justify-between bg-background px-3 text-muted-foreground">
      <span>{statusLabel(activeWorkspace)}</span>
      <span>Kira v3</span>
    </footer>
  );
}

function statusLabel(activeWorkspace: ActiveWorkspaceState) {
  if (activeWorkspace.status === "active") {
    if (activeWorkspace.projectSwitch.status === "switching") {
      return `Switching project from ${activeWorkspace.project.name}…`;
    }

    if (activeWorkspace.projectSwitch.status === "error") {
      return `Project: ${activeWorkspace.project.name} · Switch failed`;
    }

    return `Project: ${activeWorkspace.project.name}`;
  }

  if (activeWorkspace.status === "loading") {
    return "Opening project…";
  }

  if (activeWorkspace.status === "error") {
    return "Project open failed";
  }

  return "No Project";
}

export { AppStatusBar };
