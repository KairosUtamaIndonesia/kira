/**
 * Pattern compilation and matching for guardrails.
 *
 * Supports:
 * - `*` matches any characters except `/` (single path segment)
 * - `**` matches any characters including `/`
 * - Literal characters match themselves
 */

export interface CompiledFilePattern {
  pattern: string;
  test: (filePath: string) => boolean;
}

const STAR_TOKEN = "@@STAR@@";

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, STAR_TOKEN)
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(STAR_TOKEN, "g"), ".*");

  if (pattern.startsWith("~")) {
    return new RegExp(`^${escaped}$`);
  }

  if (!pattern.includes("/") && !pattern.startsWith("~")) {
    return new RegExp(`(^|[/\\\\])${escaped}$`);
  }

  return new RegExp(`^${escaped}$`);
}

export function compileFilePattern(pattern: string): CompiledFilePattern {
  const regex = globToRegex(pattern);
  return {
    pattern,
    test: (filePath: string) => regex.test(filePath),
  };
}

export function compileFilePatterns(patterns: string[]): CompiledFilePattern[] {
  return patterns.map(compileFilePattern);
}

export function matchFilePattern(
  filePath: string,
  compiled: CompiledFilePattern[],
): CompiledFilePattern | undefined {
  for (const cp of compiled) {
    if (cp.test(filePath)) return cp;
  }
  return undefined;
}
