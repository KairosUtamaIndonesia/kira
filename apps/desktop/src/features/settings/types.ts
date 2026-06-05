type AppearanceTheme = "light" | "dark";

type AppearanceSettings = {
  theme: AppearanceTheme;
  agentThreadShowRawEventStream: boolean;
};

type AppearanceSettingsUpdateInput = {
  theme: AppearanceTheme;
  agentThreadShowRawEventStream: boolean;
};

export type { AppearanceSettings, AppearanceSettingsUpdateInput, AppearanceTheme };
