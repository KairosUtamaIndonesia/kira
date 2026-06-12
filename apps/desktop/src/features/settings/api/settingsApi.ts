import { invoke } from "@tauri-apps/api/core";

import type {
  AppearanceSettings,
  AppearanceSettingsUpdateInput,
  CustomNotificationSound,
  NotificationSettings,
  NotificationSettingsUpdateInput,
  NotificationSoundImportInput,
  TerminalSettings,
  TerminalSettingsUpdateInput,
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

function readNotificationSound(soundId: string) {
  return invoke<number[]>("notification_sound_read", { soundId });
}

function getTerminalSettings() {
  return invoke<TerminalSettings>("terminal_settings_get").then((settings) => ({
    shellPath: settings.shellPath ?? undefined,
    terminalShellPath: settings.terminalShellPath ?? undefined,
  }));
}

function updateTerminalSettings(input: TerminalSettingsUpdateInput) {
  return invoke<TerminalSettings>("terminal_settings_update", {
    input: {
      // oxlint-disable-next-line unicorn/no-null — null required by Rust Option<String> deserialization
      shellPath: input.shellPath ?? null,
      // oxlint-disable-next-line unicorn/no-null — null required by Rust Option<String> deserialization
      terminalShellPath: input.terminalShellPath ?? null,
    },
  }).then((settings) => ({
    shellPath: settings.shellPath ?? undefined,
    terminalShellPath: settings.terminalShellPath ?? undefined,
  }));
}
export {
  getAppearanceSettings,
  getNotificationSettings,
  getTerminalSettings,
  importNotificationSound,
  readNotificationSound,
  removeNotificationSound,
  updateAppearanceSettings,
  updateNotificationSettings,
  updateTerminalSettings,
};
