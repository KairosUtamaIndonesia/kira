import type {
  GuardrailsCommandPattern,
  GuardrailsConfig,
  GuardrailsPolicyRule,
  GuardrailsProtection,
} from "@/features/settings/types";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizeProtection(value: unknown): GuardrailsProtection {
  return value === "none" || value === "readOnly" || value === "noAccess" ? value : "noAccess";
}

function normalizeRules(value: unknown): GuardrailsPolicyRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rules: GuardrailsPolicyRule[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (typeof record.id !== "string") {
      continue;
    }

    rules.push({
      id: record.id,
      patterns: asStringArray(record.patterns),
      protection: normalizeProtection(record.protection),
    });
  }

  return rules;
}

function normalizeCommandPatterns(value: unknown): GuardrailsCommandPattern[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const patterns: GuardrailsCommandPattern[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (typeof record.pattern !== "string" || typeof record.description !== "string") {
      continue;
    }

    patterns.push({ pattern: record.pattern, description: record.description });
  }

  return patterns;
}

/**
 * Normalizes the stored guardrails config (opaque JSON from the Rust persistence
 * layer) into a fully-populated, typed config. Missing fields fall back to the
 * product defaults: everything enabled, no user overrides.
 */
function normalizeGuardrailsConfig(raw: unknown): GuardrailsConfig {
  const root = asRecord(raw);
  const features = asRecord(root.features);
  const policies = asRecord(root.policies);
  const permissionGate = asRecord(root.permissionGate);

  return {
    enabled: asBoolean(root.enabled, true),
    features: {
      policies: asBoolean(features.policies, true),
      permissionGate: asBoolean(features.permissionGate, true),
    },
    policies: {
      rules: normalizeRules(policies.rules),
    },
    permissionGate: {
      useBuiltinMatchers: asBoolean(permissionGate.useBuiltinMatchers, true),
      requireConfirmation: asBoolean(permissionGate.requireConfirmation, true),
      patterns: normalizeCommandPatterns(permissionGate.patterns),
      allowedPatterns: asStringArray(permissionGate.allowedPatterns),
      autoDenyPatterns: asStringArray(permissionGate.autoDenyPatterns),
    },
  };
}

export { normalizeGuardrailsConfig };
