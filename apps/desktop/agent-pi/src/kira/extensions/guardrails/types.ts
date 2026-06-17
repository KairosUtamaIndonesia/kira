/**
 * Core types for the Guardrails extension.
 *
 * Two layers: GuardrailsConfig (user-facing, all fields optional)
 * and ResolvedGuardrailsConfig (internal, all fields required with defaults applied).
 */

/** Protection level for a file policy rule. */
export type Protection = "none" | "readOnly" | "noAccess";

/** A named file protection policy rule.
 * Settings UI mirrors a subset via GuardrailsPolicyRule
 * (see apps/desktop/src/features/settings/types.ts). */
export interface PolicyRule {
  /** Stable identifier used for deduplication. */
  id: string;
  /** Optional display name. */
  name?: string;
  /** Human-readable description. */
  description?: string;
  /** Glob patterns for files to protect. */
  patterns: string[];
  /** Glob patterns for files to exempt (bypass protection). */
  allowedPatterns?: string[];
  /** Protection level. */
  protection: Protection;
  /** Message shown when blocked; supports {file} placeholder. */
  blockMessage?: string;
  /** Per-rule toggle. Default true. */
  enabled?: boolean;
}

/** Dangerous command pattern (substring match by default). */
export interface DangerousPattern {
  /** Substring to match against the raw command. */
  pattern: string;
  /** Description surfaced to the agent when the pattern triggers. */
  description: string;
}

/** File protection policies config section. */
export interface FilePoliciesConfig {
  rules: PolicyRule[];
}

/** Dangerous command gate config section. */
export interface PermissionGateConfig {
  /** Additional dangerous command patterns. */
  patterns: DangerousPattern[];
  /** When true, use hardcoded structural matchers for built-in patterns. */
  useBuiltinMatchers: boolean;
  /** When true, prompt before running dangerous commands. */
  requireConfirmation: boolean;
  /** Command substrings that bypass prompts. */
  allowedPatterns: string[];
  /** Command substrings that are always blocked without prompting. */
  autoDenyPatterns: string[];
}

/** User-facing config (all fields optional). */
export interface GuardrailsConfig {
  /** Enable or disable all guardrails checks. */
  enabled?: boolean;
  /** Enable or disable individual features. */
  features?: {
    /** File protection policies. Default true. */
    policies?: boolean;
    /** Dangerous command gate. Default true. */
    permissionGate?: boolean;
  };
  /** File protection policies. */
  policies?: FilePoliciesConfig;
  /** Dangerous command gate. */
  permissionGate?: PermissionGateConfig;
}

/** Resolved config (all fields required, defaults applied). */
export interface ResolvedGuardrailsConfig {
  enabled: boolean;
  features: {
    policies: boolean;
    permissionGate: boolean;
  };
  policies: FilePoliciesConfig;
  permissionGate: PermissionGateConfig;
}

/** Scope for a grant (permission override). */
export type GrantScope = "once" | "session";

/** A grant that bypasses a guardrails check. */
export interface Grant {
  /** Normalized key for the granted action. */
  key: string;
  /** Scope of the grant. */
  scope: GrantScope;
  /** Timestamp when the grant was created. */
  createdAt: number;
}

/** Result of a guardrails match. */
export interface GuardrailsMatch {
  /** The pattern that matched. */
  pattern: string;
  /** Description of why it matched. */
  description: string;
}

/** Outcome of a guardrails check. */
export type GuardrailsAction =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "prompt"; reason: string; match: GuardrailsMatch };

/** Options passed to prompt handlers. */
export interface PromptOptions {
  /** Label for the action being checked (e.g. "read file", "bash"). */
  label: string;
  /** The target being checked (file path or command). */
  target: string;
  /** The reason why a prompt is needed. */
  reason: string;
  /** Tool name that triggered the check. */
  toolName: string;
}
