import { useEffect, useRef, useState } from "react";

import { AppWindowControls } from "@/features/app-shell/components/AppWindowControls";
import { useTitleBarDrag } from "@/features/app-shell/components/useTitleBarDrag";
import { SettingsSidebar } from "@/features/settings/components/SettingsSidebar";
import {
  findSettingsSection,
  settingsGroupLabelForSection,
  type SettingsSectionId,
} from "@/features/settings/settingsSections";

type SettingsPageProps = {
  state: "opening" | "open" | "closing";
  onClose: () => void;
  onClosed: () => void;
  onEntered: () => void;
};

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
  const ActiveSettingsSection = activeSection.render;

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
      <SettingsSidebar
        activeSectionId={activeSectionId}
        backButtonRef={backButtonRef}
        titleBarError={titleBarError}
        onBack={onClose}
        onSectionSelect={setActiveSectionId}
        onTitleBarDoubleClick={(event) => {
          void handleTitleBarDoubleClick(event);
        }}
        onTitleBarMouseDown={(event) => {
          void handleTitleBarMouseDown(event);
        }}
      />

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
            <ActiveSettingsSection />
          </div>
        </div>
      </main>
    </dialog>
  );
}

export { SettingsPage };
