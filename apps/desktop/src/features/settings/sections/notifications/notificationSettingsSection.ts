import { Bell } from "lucide-react";

import { NotificationSettings } from "@/features/settings/sections/notifications/NotificationSettings";

const notificationSettingsSection = {
  id: "notifications",
  label: "Notifications",
  description: "Control Kira notification sounds.",
  icon: Bell,
  render: NotificationSettings,
} as const;

export { notificationSettingsSection };
