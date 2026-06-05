import { invoke } from "@tauri-apps/api/core";

import type {
  AppearanceSettings,
  AppearanceSettingsUpdateInput,
  CustomNotificationSound,
  NotificationSettings,
  NotificationSettingsUpdateInput,
  NotificationSoundImportInput,
} from "@/features/settings/types";

function getAppearanceSettings() {
  return invoke<AppearanceSettings>("appearance_settings_get");
}

function updateAppearanceSettings(input: AppearanceSettingsUpdateInput) {
  return invoke<AppearanceSettings>("appearance_settings_update", { input });
}

function getNotificationSettings() {
  return invoke<NotificationSettings>("notification_settings_get");
}

function updateNotificationSettings(input: NotificationSettingsUpdateInput) {
  return invoke<NotificationSettings>("notification_settings_update", { input });
}

function importNotificationSound(input: NotificationSoundImportInput) {
  return invoke<CustomNotificationSound>("notification_sound_import", { input });
}

function removeNotificationSound(soundId: string) {
  return invoke<NotificationSettings>("notification_sound_remove", { soundId });
}

export {
  getAppearanceSettings,
  getNotificationSettings,
  importNotificationSound,
  removeNotificationSound,
  updateAppearanceSettings,
  updateNotificationSettings,
};
