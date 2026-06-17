/**
 * Dangerous command gate handler.
 */

import type { Program, SimpleCommand, Word } from "@aliou/sh";

import { parse } from "@aliou/sh";

import type { DangerousPattern, GuardrailsAction, PermissionGateConfig } from "../types";

import { GrantStore } from "../grants";

function wordToString(word: Word): string {
  function partToString(part: Word["parts"][number]): string {
    switch (part.type) {
      case "Literal":
        return part.value;
      case "SglQuoted":
        return part.value;
      case "DblQuoted":
        return part.parts.map(partToString).join("");
      case "ParamExp":
        return part.short ? `$${part.param.value}` : `\${${part.param.value}}`;
      case "CmdSubst":
        return "$(...)";
      case "ArithExp":
        return "$((" + (part.x.type === "ArithLit" ? part.x.value : "...") + "))";
      case "ProcSubst":
        return `${part.op}(...)`;
      case "BraceExp":
        return "{" + part.elems.map(wordToString).join(",") + "}";
      case "ExtGlob":
        return part.op + part.pattern + ")";
      default:
        return "";
    }
  }
  return word.parts.map(partToString).join("");
}

function walkCommands(node: Program, callback: (cmd: SimpleCommand) => boolean | void): void {
  const visit = (val: unknown): boolean | void => {
    if (val === null || typeof val !== "object") return;
    const c = val as Record<string, unknown>;
    if (c.type === "SimpleCommand") {
      if (callback(c as SimpleCommand)) return true;
    }
    for (const key of ["left", "right", "command"]) {
      if (key in c) {
        if (visit(c[key])) return true;
      }
    }
  };
  for (const stmt of node.body) {
    if (visit(stmt)) return;
  }
}

function hasArg(words: string[], prefix: string): boolean {
  return words.some((w) => w.startsWith(prefix));
}

function hasShortFlag(words: string[], flag: string): boolean {
  return words.some((w) => /^-[a-z]*$/i.test(w) && w.includes(flag));
}

function hasLongOption(words: string[], option: string): boolean {
  return words.some((w) => w === `--${option}`);
}

type StructuralMatcher = (words: string[]) => string | undefined;

const rmMatcher: StructuralMatcher = (words) => {
  if (words[0] !== "rm") return;
  const hasRecursive =
    hasShortFlag(words, "r") ||
    hasShortFlag(words, "R") ||
    hasLongOption(words, "recursive") ||
    hasLongOption(words, "dir");
  const hasForce = hasShortFlag(words, "f") || hasLongOption(words, "force");
  return hasRecursive && hasForce ? "recursive force delete" : undefined;
};

const shredMatcher: StructuralMatcher = (words) =>
  words[0] === "shred" ? "secure file overwrite" : undefined;

const sudoMatcher: StructuralMatcher = (words) =>
  words[0] === "sudo" ? "superuser command" : undefined;

const doasMatcher: StructuralMatcher = (words) =>
  words[0] === "doas" ? "privileged command execution" : undefined;

const pkexecMatcher: StructuralMatcher = (words) =>
  words[0] === "pkexec" ? "privileged command execution" : undefined;

const ddMatcher: StructuralMatcher = (words) =>
  words[0] === "dd" && hasArg(words, "of=") ? "disk write operation" : undefined;

const mkfsMatcher: StructuralMatcher = (words) => {
  const cmd = words[0];
  return cmd === "mkfs" || (cmd !== undefined && cmd.startsWith("mkfs."))
    ? "filesystem format"
    : undefined;
};

const wipefsMatcher: StructuralMatcher = (words) =>
  words[0] === "wipefs" ? "filesystem signature wipe" : undefined;

const blkdiscardMatcher: StructuralMatcher = (words) =>
  words[0] === "blkdiscard" ? "block device discard" : undefined;

const fdiskMatcher: StructuralMatcher = (words) => {
  const cmd = words[0];
  return cmd === "fdisk" || cmd === "sfdisk" || cmd === "cfdisk" ? "disk partitioning" : undefined;
};

const partedMatcher: StructuralMatcher = (words) => {
  const cmd = words[0];
  return cmd === "parted" || cmd === "sgdisk" ? "disk partitioning" : undefined;
};

const chmodMatcher: StructuralMatcher = (words) => {
  if (words[0] !== "chmod") return;
  const hasRecursive = hasShortFlag(words, "R") || hasLongOption(words, "recursive");
  const hasWorldWritable = words.some(
    (w) =>
      w === "777" ||
      w === "0777" ||
      w === "a+rwx" ||
      w === "ugo+rwx" ||
      w === "7777" ||
      w === "1777",
  );
  return hasRecursive && hasWorldWritable ? "insecure recursive permissions" : undefined;
};

const chownMatcher: StructuralMatcher = (words) => {
  if (words[0] !== "chown") return;
  return hasShortFlag(words, "R") || hasLongOption(words, "recursive")
    ? "recursive ownership change"
    : undefined;
};

const containerMatcher: StructuralMatcher = (words) => {
  const cmd = words[0];
  if (cmd !== "docker" && cmd !== "podman") return;
  const subcommand = words[1];
  if (subcommand !== "run" && subcommand !== "create") return;

  const hasFlag = (flag: string) => words.some((w) => w === flag || w.startsWith(flag + "="));

  if (hasFlag("--privileged")) return "container with privileged mode";
  if (hasFlag("--pid=host")) return "container with host PID namespace";
  if (hasFlag("--network=host")) return "container with host network";
  if (hasFlag("--userns=host")) return "container with host user namespace";
  if (hasFlag("--uts=host")) return "container with host UTS namespace";
  if (hasFlag("--ipc=host")) return "container with host IPC";

  if (
    words.some(
      (w) =>
        w.startsWith("-v/:") ||
        w.startsWith("-v/=>") ||
        w.startsWith("--volume=/:") ||
        w.startsWith("--mount=type=bind,source=/,"),
    )
  ) {
    return "container with root filesystem mount";
  }
  if (
    words.some(
      (w) =>
        w.includes("/var/run/docker.sock") ||
        w.includes("/run/docker.sock") ||
        w.includes("/var/run/podman.sock") ||
        w.includes("/run/podman.sock"),
    )
  ) {
    return "container with docker socket access";
  }
  return;
};

const BUILTIN_MATCHERS: StructuralMatcher[] = [
  rmMatcher,
  shredMatcher,
  sudoMatcher,
  doasMatcher,
  pkexecMatcher,
  ddMatcher,
  mkfsMatcher,
  wipefsMatcher,
  blkdiscardMatcher,
  fdiskMatcher,
  partedMatcher,
  chmodMatcher,
  chownMatcher,
  containerMatcher,
];

interface CommandMatch {
  pattern: string;
  description: string;
}

function matchBuiltin(words: string[]): CommandMatch | undefined {
  for (const matcher of BUILTIN_MATCHERS) {
    const description = matcher(words);
    if (description !== undefined) return { pattern: "(structural)", description };
  }
  return undefined;
}

function matchSubstring(command: string, patterns: DangerousPattern[]): CommandMatch | undefined {
  for (const p of patterns) {
    if (command.includes(p.pattern)) {
      return { pattern: p.pattern, description: p.description };
    }
  }
  return undefined;
}

export function matchDangerousCommand(
  command: string,
  config: PermissionGateConfig,
): CommandMatch | undefined {
  for (const allowed of config.allowedPatterns) {
    if (command.includes(allowed)) return undefined;
  }

  for (const deny of config.autoDenyPatterns) {
    if (command.includes(deny)) {
      return { pattern: deny, description: "auto-denied" };
    }
  }

  if (config.useBuiltinMatchers) {
    try {
      const { ast } = parse(command);
      let match: CommandMatch | undefined;
      walkCommands(ast, (cmd) => {
        const words = (cmd.words ?? []).map(wordToString);
        const result = matchBuiltin(words);
        if (result !== undefined) {
          match = result;
          return true;
        }
        return false;
      });
      if (match !== undefined) return match;
    } catch {
      // Parse failed — fall through to substring
    }
  }

  if (config.patterns.length > 0) {
    return matchSubstring(command, config.patterns);
  }

  return undefined;
}

export function checkCommand(
  command: string,
  config: PermissionGateConfig,
  grants: GrantStore,
): GuardrailsAction {
  if (grants.check(GrantStore.commandKey(command))) {
    return { action: "allow" };
  }

  const match = matchDangerousCommand(command, config);
  if (match === undefined) return { action: "allow" };

  if (config.autoDenyPatterns.some((p) => command.includes(p))) {
    return {
      action: "block",
      reason: `Command auto-denied: ${match.description}. This command was blocked automatically.`,
    };
  }

  if (!config.requireConfirmation) {
    return { action: "allow" };
  }

  return {
    action: "prompt",
    reason: match.description,
    match: { pattern: match.pattern, description: match.description },
  };
}
