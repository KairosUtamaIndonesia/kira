import { User } from "lucide-react";

import { GeneralSettings } from "@/features/settings/sections/general/GeneralSettings";

const generalSettingsSection = {
  id: "general",
  label: "General",
  description: "Account and organization for this installation.",
  icon: User,
  render: GeneralSettings,
} as const;

export { generalSettingsSection };
