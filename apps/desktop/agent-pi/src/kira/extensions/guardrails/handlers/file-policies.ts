/**
 * File protection policies handler.
 */

import type { GuardrailsAction, PolicyRule } from "../types";

import { GrantStore } from "../grants";
import { compileFilePatterns, matchFilePattern, type CompiledFilePattern } from "../patterns";

const FILE_READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const FILE_WRITE_TOOLS = new Set(["write", "edit"]);

interface CompiledPolicyRule {
  rule: PolicyRule;
  blockPatterns: CompiledFilePattern[];
  allowedPatterns: CompiledFilePattern[];
}

function normalizePath(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return filePath.replace("~", home);
  }
  return filePath;
}

export class FilePoliciesChecker {
  private compiled: CompiledPolicyRule[] = [];

  compile(rules: PolicyRule[]): void {
    this.compiled = rules
      .filter((r) => r.enabled !== false)
      .map((rule) => ({
        rule,
        blockPatterns: compileFilePatterns(rule.patterns),
        allowedPatterns:
          rule.allowedPatterns !== undefined ? compileFilePatterns(rule.allowedPatterns) : [],
      }));
  }

  check(toolName: string, filePath: string, grants: GrantStore): GuardrailsAction {
    if (!FILE_READ_TOOLS.has(toolName) && !FILE_WRITE_TOOLS.has(toolName)) {
      return { action: "allow" };
    }

    const normalized = normalizePath(filePath);

    if (grants.check(GrantStore.fileKey(normalized))) {
      return { action: "allow" };
    }

    for (const rule of this.compiled) {
      if (rule.allowedPatterns.length > 0 && matchFilePattern(normalized, rule.allowedPatterns)) {
        continue;
      }

      const match = matchFilePattern(normalized, rule.blockPatterns);
      if (!match) continue;

      if (rule.rule.protection === "noAccess") {
        return {
          action: "block",
          reason:
            rule.rule.blockMessage !== undefined
              ? rule.rule.blockMessage.replace(/\{file\}/g, filePath)
              : `Accessing ${filePath} is protected by guardrails policy.`,
        };
      }

      if (rule.rule.protection === "readOnly" && FILE_WRITE_TOOLS.has(toolName)) {
        return {
          action: "block",
          reason:
            rule.rule.blockMessage !== undefined
              ? rule.rule.blockMessage.replace(/\{file\}/g, filePath)
              : `Accessing ${filePath} is protected by guardrails policy.`,
        };
      }
    }

    return { action: "allow" };
  }
}
