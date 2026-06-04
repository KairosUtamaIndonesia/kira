type AppearanceTheme = "light" | "dark";

type AppearanceSettings = {
  theme: AppearanceTheme;
};

type AppearanceSettingsUpdateInput = {
  theme: AppearanceTheme;
};

export type { AppearanceSettings, AppearanceSettingsUpdateInput, AppearanceTheme };
