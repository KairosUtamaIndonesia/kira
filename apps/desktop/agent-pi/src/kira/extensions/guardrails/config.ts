/**
 * Config loading for the Guardrails extension.
 *
 * Reads the guardrails config from the SQLite app_settings table (key:
 * ``guardrails_config``), then merges with hardcoded defaults. Falls back to
 * defaults-only when no row is found or the database cannot be opened.
 */

import { Database } from "bun:sqlite";
import { statSync } from "node:fs";

import type {
  DangerousPattern,
  GuardrailsConfig,
  PolicyRule,
  ResolvedGuardrailsConfig,
} from "./types";

import { readPiDataDir } from "../../env";
import { DEFAULT_CONFIG } from "./defaults";

let cachedConfig: ResolvedGuardrailsConfig | undefined;
let cachedDbMtime: number | undefined;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPolicyRule(value: unknown): value is PolicyRule {
  if (typeof value !== "object" || value === null) return false;
  const rule = value as Record<string, unknown>;
  if (typeof rule.id !== "string") return false;
  if (!Array.isArray(rule.patterns) || !rule.patterns.every((p) => typeof p === "string"))
    return false;
  const protection = rule.protection;
  if (protection !== "none" && protection !== "readOnly" && protection !== "noAccess") return false;
  return true;
}

function isDangerousPattern(value: unknown): value is { pattern: string; description: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { pattern: string; description: string }).pattern === "string" &&
    typeof (value as { pattern: string; description: string }).description === "string"
  );
}

/** Built-in entries always apply; user entries append unless already present. */
function mergeStringList(base: string[], extra: unknown): string[] {
  const result = base.slice();
  const seen = new Set(base);
  if (isStringArray(extra)) {
    for (const item of extra) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
  }
  return result;
}

/** Built-in patterns always apply; user patterns append unless the pattern string already exists. */
function mergeDangerousPatterns(base: DangerousPattern[], extra: unknown): DangerousPattern[] {
  const result = base.slice();
  const seen = new Set(base.map((p) => p.pattern));
  if (Array.isArray(extra)) {
    for (const p of extra) {
      if (isDangerousPattern(p) && !seen.has(p.pattern)) {
        seen.add(p.pattern);
        result.push({ pattern: p.pattern, description: p.description });
      }
    }
  }
  return result;
}

function mergeConfig(
  defaults: ResolvedGuardrailsConfig,
  user: GuardrailsConfig,
): ResolvedGuardrailsConfig {
  const features = {
    policies:
      user.features !== undefined
        ? (user.features.policies ?? defaults.features.policies)
        : defaults.features.policies,
    permissionGate:
      user.features !== undefined
        ? (user.features.permissionGate ?? defaults.features.permissionGate)
        : defaults.features.permissionGate,
  };

  // File policy rules: built-in rules always apply. A user rule appends, and a
  // user rule sharing a built-in id overrides that built-in.
  const rulesById = new Map<string, PolicyRule>();
  for (const rule of defaults.policies.rules) {
    rulesById.set(rule.id, rule);
  }
  if (user.policies !== undefined && Array.isArray(user.policies.rules)) {
    for (const rule of user.policies.rules) {
      if (isPolicyRule(rule)) {
        rulesById.set(rule.id, {
          id: rule.id,
          patterns: rule.patterns,
          protection: rule.protection as PolicyRule["protection"],
        });
      }
    }
  }
  const policies: ResolvedGuardrailsConfig["policies"] = { rules: [...rulesById.values()] };

  const pg = user.permissionGate;
  const pgDefaults = defaults.permissionGate;
  const permissionGate: ResolvedGuardrailsConfig["permissionGate"] = {
    allowedPatterns: mergeStringList(
      pgDefaults.allowedPatterns,
      pg !== undefined ? pg.allowedPatterns : undefined,
    ),
    autoDenyPatterns: mergeStringList(
      pgDefaults.autoDenyPatterns,
      pg !== undefined ? pg.autoDenyPatterns : undefined,
    ),
    patterns: mergeDangerousPatterns(
      pgDefaults.patterns,
      pg !== undefined ? pg.patterns : undefined,
    ),
    useBuiltinMatchers:
      pg !== undefined
        ? (pg.useBuiltinMatchers ?? pgDefaults.useBuiltinMatchers)
        : pgDefaults.useBuiltinMatchers,
    requireConfirmation:
      pg !== undefined
        ? (pg.requireConfirmation ?? pgDefaults.requireConfirmation)
        : pgDefaults.requireConfirmation,
  };

  return {
    enabled: user.enabled ?? defaults.enabled,
    features,
    policies,
    permissionGate,
  };
}

function readConfigFromDb(dbPath: string): GuardrailsConfig | undefined {
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = 'guardrails_config'")
      .get() as { value: string } | undefined;
    db.close();
    if (row === undefined) return undefined;
    const parsed: unknown = JSON.parse(row.value);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return parsed as GuardrailsConfig;
  } catch {
    return undefined;
  }
}

export function loadGuardrailsConfig(): ResolvedGuardrailsConfig {
  const dataDir = readPiDataDir();
  if (dataDir === undefined) return DEFAULT_CONFIG;

  const dbPath = `${dataDir}/kira.sqlite3`;

  // stat is ~µs per call — avoid opening SQLite when nothing changed
  let currentMtime = -1;
  try {
    const main = statSync(dbPath, { throwIfNoEntry: false });
    const wal = statSync(`${dbPath}-wal`, { throwIfNoEntry: false });
    let mtime = 0;
    if (main !== undefined) {
      mtime = main.mtimeMs;
    }
    if (wal !== undefined) {
      const walMtime = wal.mtimeMs;
      if (walMtime > mtime) {
        mtime = walMtime;
      }
    }
    currentMtime = mtime;
  } catch {
    // stat failure is not fatal — fall through to re-read from SQLite
  }

  if (cachedConfig !== undefined && cachedDbMtime !== undefined && cachedDbMtime === currentMtime) {
    return cachedConfig;
  }

  const userConfig = readConfigFromDb(dbPath);
  const result =
    userConfig === undefined ? DEFAULT_CONFIG : mergeConfig(DEFAULT_CONFIG, userConfig);

  cachedConfig = result;
  cachedDbMtime = currentMtime;
  return result;
}
