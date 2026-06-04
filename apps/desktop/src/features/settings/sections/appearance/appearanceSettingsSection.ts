import { Monitor } from "lucide-react";

import { AppearanceSettings } from "@/features/settings/sections/appearance/AppearanceSettings";

const appearanceSettingsSection = {
  id: "appearance",
  label: "Appearance",
  description: "Control how Kira looks and feels.",
  icon: Monitor,
  render: AppearanceSettings,
} as const;

export { appearanceSettingsSection };
