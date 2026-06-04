import { invoke } from "@tauri-apps/api/core";

import type { AppearanceSettings, AppearanceSettingsUpdateInput } from "@/features/settings/types";

function getAppearanceSettings() {
  return invoke<AppearanceSettings>("appearance_settings_get");
}

function updateAppearanceSettings(input: AppearanceSettingsUpdateInput) {
  return invoke<AppearanceSettings>("appearance_settings_update", { input });
}

export { getAppearanceSettings, updateAppearanceSettings };
