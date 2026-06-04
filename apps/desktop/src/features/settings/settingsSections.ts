import { appearanceSettingsSection } from "@/features/settings/sections/appearance/appearanceSettingsSection";

const settingsGroups = [
  {
    label: "Interface",
    sections: [appearanceSettingsSection],
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
