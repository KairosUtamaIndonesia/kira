type AppearanceTheme = "light" | "dark";

type AppearanceSettings = {
  theme: AppearanceTheme;
  agentThreadShowRawEventStream: boolean;
};

type AppearanceSettingsUpdateInput = {
  theme: AppearanceTheme;
  agentThreadShowRawEventStream: boolean;
};

type BundledNotificationSound = {
  id: string;
  label: string;
  kind: "bundled";
  url: string;
};

type CustomNotificationSound = {
  id: string;
  label: string;
  kind: "custom";
  path: string;
};

type NotificationSound = BundledNotificationSound | CustomNotificationSound;

type NotificationSettings = {
  enabled: boolean;
  volume: number;
  selectedSoundId: string;
  bundledSounds: readonly BundledNotificationSound[];
  customSounds: CustomNotificationSound[];
};

type NotificationSettingsUpdateInput = {
  enabled: boolean;
  volume: number;
  selectedSoundId: string;
};

type NotificationSoundImportInput = {
  fileName: string;
  bytes: number[];
};

export type {
  AppearanceSettings,
  AppearanceSettingsUpdateInput,
  AppearanceTheme,
  BundledNotificationSound,
  CustomNotificationSound,
  NotificationSettings,
  NotificationSettingsUpdateInput,
  NotificationSound,
  NotificationSoundImportInput,
};
