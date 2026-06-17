import { appearanceSettingsSection } from "@/features/settings/sections/appearance/appearanceSettingsSection";
import { generalSettingsSection } from "@/features/settings/sections/general/generalSettingsSection";
import { guardrailsSettingsSection } from "@/features/settings/sections/guardrails/guardrailsSettingsSection";
import { notificationSettingsSection } from "@/features/settings/sections/notifications/notificationSettingsSection";
import { terminalSettingsSection } from "@/features/settings/sections/terminal/terminalSettingsSection";

const settingsGroups = [
  {
    label: "General",
    sections: [generalSettingsSection, terminalSettingsSection],
  },
  {
    label: "Agent",
    sections: [guardrailsSettingsSection],
  },
  {
    label: "Interface",
    sections: [appearanceSettingsSection, notificationSettingsSection],
  },
] as const;

type SettingsGroup = (typeof settingsGroups)[number];
type SettingsSection = SettingsGroup["sections"][number];
type SettingsSectionId = SettingsSection["id"];

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

export { findSettingsSection, settingsGroupLabelForSection, settingsGroups };
export type { SettingsSectionId };
