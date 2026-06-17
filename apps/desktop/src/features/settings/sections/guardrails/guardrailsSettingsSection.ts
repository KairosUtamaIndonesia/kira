import { ShieldCheck } from "lucide-react";

import { GuardrailsSettings } from "@/features/settings/sections/guardrails/GuardrailsSettings";

const guardrailsSettingsSection = {
  id: "guardrails",
  label: "Guardrails",
  description: "Protect sensitive files and gate dangerous commands.",
  icon: ShieldCheck,
  render: GuardrailsSettings,
} as const;

export { guardrailsSettingsSection };
