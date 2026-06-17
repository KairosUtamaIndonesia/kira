import { Database } from "lucide-react";

import { MemorySettings } from "@/features/memory/sections/MemorySettings";

const memorySettingsSection = {
  id: "memory",
  label: "Memory",
  description: "Browse and edit the agent's persistent memory.",
  icon: Database,
  render: MemorySettings,
} as const;

export { memorySettingsSection };
