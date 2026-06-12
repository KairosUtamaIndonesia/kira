import { User } from "lucide-react";

import { GeneralSettings } from "@/features/settings/sections/general/GeneralSettings";

const generalSettingsSection = {
  id: "general",
  label: "Account",
  description: "Account and organization for this installation.",
  icon: User,
  render: GeneralSettings,
} as const;

export { generalSettingsSection };
