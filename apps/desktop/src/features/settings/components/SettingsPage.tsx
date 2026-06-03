import { ArrowLeft, Monitor } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { AppWindowControls } from "@/features/app-shell/components/AppWindowControls";
import { useTitleBarDrag } from "@/features/app-shell/components/useTitleBarDrag";

type SettingsSectionId = "appearance";

type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  description: string;
};

type SettingsGroup = {
  label: string;
  sections: SettingsSection[];
};

type SettingsPageProps = {
  state: "opening" | "open" | "closing";
  onClose: () => void;
  onClosed: () => void;
  onEntered: () => void;
};

const settingsGroups = [
  {
    label: "Interface",
    sections: [
      {
        id: "appearance",
        label: "Appearance",
        description: "Control how Kira looks and feels.",
      },
    ],
  },
] as const satisfies SettingsGroup[];

function SettingsPage({ state, onClose, onClosed, onEntered }: SettingsPageProps) {
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>("appearance");
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const { handleTitleBarDoubleClick, handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();

  useEffect(() => {
    if (backButtonRef.current !== null) {
      backButtonRef.current.focus();
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(
    function syncSettingsAnimationState(): void | (() => void) {
      if (state === "opening") {
        const timeoutId = window.setTimeout(onEntered, 260);
        return () => window.clearTimeout(timeoutId);
      }

      if (state === "closing") {
        const timeoutId = window.setTimeout(onClosed, 240);
        return () => window.clearTimeout(timeoutId);
      }

      return;
    },
    [onClosed, onEntered, state],
  );

  const activeSection = findSettingsSection(activeSectionId);

  return (
    <dialog
      open
      aria-labelledby="settings-title"
      data-state={state}
      className="kira-settings-surface fixed inset-0 z-50 m-0 grid h-dvh max-h-none w-screen max-w-none grid-cols-[16rem_minmax(0,1fr)] overflow-hidden border-0 bg-background p-0 text-foreground shadow-xs backdrop:bg-transparent"
      onAnimationEnd={(event) => {
        if (event.currentTarget !== event.target) {
          return;
        }

        if (event.animationName === "kira-settings-enter") {
          onEntered();
          return;
        }

        if (event.animationName === "kira-settings-exit") {
          onClosed();
        }
      }}
    >
      <SidebarProvider className="h-full min-h-0 text-sm">
        <Sidebar collapsible="none" className="w-full border-r border-sidebar-border">
          <SidebarHeader
            role="toolbar"
            aria-label="Settings title bar"
            tabIndex={-1}
            className="h-11 justify-center border-b border-sidebar-border px-2 py-0 select-none"
            onDoubleClick={(event) => {
              void handleTitleBarDoubleClick(event);
            }}
            onMouseDown={(event) => {
              void handleTitleBarMouseDown(event);
            }}
          >
            <Button
              ref={backButtonRef}
              type="button"
              variant="ghost"
              className="w-full justify-start"
              onClick={onClose}
            >
              <ArrowLeft aria-hidden="true" />
              Back to Kira
            </Button>
            {titleBarError === undefined ? undefined : (
              <output className="sr-only">{titleBarError}</output>
            )}
          </SidebarHeader>
          <SidebarContent className="scrollbar-sleek">
            {settingsGroups.map((group) => (
              <SidebarGroup key={group.label} aria-label={group.label}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.sections.map((section) => (
                      <SidebarMenuItem key={section.id}>
                        <SidebarMenuButton
                          type="button"
                          isActive={activeSectionId === section.id}
                          onClick={() => setActiveSectionId(section.id)}
                        >
                          <Monitor aria-hidden="true" />
                          <span>{section.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>

      <main className="flex min-h-0 flex-col bg-background">
        <div
          role="toolbar"
          aria-label="Settings window controls"
          tabIndex={-1}
          className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-sidebar pl-6 text-sidebar-foreground select-none"
          onDoubleClick={(event) => {
            void handleTitleBarDoubleClick(event);
          }}
          onMouseDown={(event) => {
            void handleTitleBarMouseDown(event);
          }}
        >
          <div className="text-sm font-medium">Settings</div>
          <AppWindowControls />
        </div>
        <div className="min-h-0 flex-1 scrollbar-sleek overflow-auto">
          <div className="mx-auto w-full max-w-4xl space-y-8 p-8">
            <header className="space-y-2">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {settingsGroupLabelForSection(activeSectionId)}
              </p>
              <div className="space-y-1">
                <h1 id="settings-title" className="text-2xl font-semibold tracking-tight">
                  {activeSection.label}
                </h1>
                <p className="text-sm text-muted-foreground">{activeSection.description}</p>
              </div>
            </header>
            {settingsContent(activeSectionId)}
          </div>
        </div>
      </main>
    </dialog>
  );
}

function settingsContent(sectionId: SettingsSectionId) {
  if (sectionId === "appearance") {
    return <AppearanceSettings />;
  }

  return assertNever(sectionId);
}

function AppearanceSettings() {
  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-medium">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Appearance preferences will live here once Kira has a durable settings store.
        </p>
      </div>
      <div className="grid gap-4 p-4">
        <div className="rounded-lg border border-dashed border-border p-4">
          <div className="text-sm font-medium">Theme</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Light, dark, and system theme controls are planned for this section.
          </p>
        </div>
      </div>
    </section>
  );
}

function findSettingsSection(sectionId: SettingsSectionId) {
  for (const group of settingsGroups) {
    const section = group.sections.find((currentSection) => currentSection.id === sectionId);
    if (section !== undefined) {
      return section;
    }
  }

  throw new Error(`Unknown settings section: ${sectionId}`);
}

function settingsGroupLabelForSection(sectionId: SettingsSectionId) {
  for (const group of settingsGroups) {
    if (group.sections.some((section) => section.id === sectionId)) {
      return group.label;
    }
  }

  throw new Error(`Unknown settings section group: ${sectionId}`);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled settings section: ${value}`);
}

export { SettingsPage };
