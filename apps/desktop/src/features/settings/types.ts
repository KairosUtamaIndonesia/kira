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

type TerminalSettings = {
  shellPath: string | undefined;
  terminalShellPath: string | undefined;
};

type TerminalSettingsUpdateInput = {
  shellPath: string | undefined;
  terminalShellPath: string | undefined;
};

type GuardrailsProtection = "none" | "readOnly" | "noAccess";

/**
 * User-facing policy rule for the guardrails settings UI.
 * Mirrors agent-pi's `PolicyRule` with only the UI-editable fields.
 * @see apps/desktop/agent-pi/src/kira/extensions/guardrails/types.ts
 */
type GuardrailsPolicyRule = {
  id: string;
  patterns: string[];
  protection: GuardrailsProtection;
};

type GuardrailsCommandPattern = {
  pattern: string;
  description: string;
};

// User-override layer only. Built-in protections live in the agent runtime
// (`agent-pi` guardrails defaults) and always apply; these fields add to or
// override them by rule id / pattern string.
type GuardrailsConfig = {
  enabled: boolean;
  features: {
    policies: boolean;
    permissionGate: boolean;
  };
  policies: {
    rules: GuardrailsPolicyRule[];
  };
  permissionGate: {
    useBuiltinMatchers: boolean;
    requireConfirmation: boolean;
    patterns: GuardrailsCommandPattern[];
    allowedPatterns: string[];
    autoDenyPatterns: string[];
  };
};

export type {
  AppearanceSettings,
  AppearanceSettingsUpdateInput,
  AppearanceTheme,
  BundledNotificationSound,
  CustomNotificationSound,
  GuardrailsCommandPattern,
  GuardrailsConfig,
  GuardrailsPolicyRule,
  GuardrailsProtection,
  NotificationSettings,
  NotificationSettingsUpdateInput,
  NotificationSound,
  NotificationSoundImportInput,
  TerminalSettings,
  TerminalSettingsUpdateInput,
};
