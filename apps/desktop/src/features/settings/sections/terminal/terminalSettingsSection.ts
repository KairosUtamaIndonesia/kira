import { Terminal } from "lucide-react";

import { TerminalSettings } from "@/features/settings/sections/terminal/TerminalSettings";

const terminalSettingsSection = {
  id: "terminal",
  label: "Terminal",
  description: "Configure shell paths for terminal and agent.",
  icon: Terminal,
  render: TerminalSettings,
} as const;

export { terminalSettingsSection };
