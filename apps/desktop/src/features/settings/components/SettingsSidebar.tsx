import type { MouseEvent, RefObject } from "react";

import { ArrowLeft } from "lucide-react";

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
import { settingsGroups, type SettingsSectionId } from "@/features/settings/settingsSections";

type SettingsSidebarProps = {
  activeSectionId: SettingsSectionId;
  backButtonRef: RefObject<HTMLButtonElement | null>;
  titleBarError: string | undefined;
  onBack: () => void;
  onSectionSelect: (sectionId: SettingsSectionId) => void;
  onTitleBarDoubleClick: (event: MouseEvent<HTMLElement>) => void;
  onTitleBarMouseDown: (event: MouseEvent<HTMLElement>) => void;
};

function SettingsSidebar({
  activeSectionId,
  backButtonRef,
  titleBarError,
  onBack,
  onSectionSelect,
  onTitleBarDoubleClick,
  onTitleBarMouseDown,
}: SettingsSidebarProps) {
  return (
    <SidebarProvider className="h-full min-h-0 text-sm">
      <Sidebar collapsible="none" className="w-full border-r border-sidebar-border">
        <SidebarHeader
          role="toolbar"
          aria-label="Settings title bar"
          tabIndex={-1}
          className="h-11 justify-center border-b border-sidebar-border px-2 py-0 select-none"
          onDoubleClick={onTitleBarDoubleClick}
          onMouseDown={onTitleBarMouseDown}
        >
          <Button
            ref={backButtonRef}
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={onBack}
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
                  {group.sections.map((section) => {
                    const Icon = section.icon;

                    return (
                      <SidebarMenuItem key={section.id}>
                        <SidebarMenuButton
                          type="button"
                          isActive={activeSectionId === section.id}
                          onClick={() => onSectionSelect(section.id)}
                        >
                          <Icon aria-hidden="true" />
                          <span>{section.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

export { SettingsSidebar };
