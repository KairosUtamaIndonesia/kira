/**
 * Hardcoded default rules for the Guardrails extension.
 *
 * These activate on first run without any user configuration.
 * User config (from env var) merges on top — rules with the same id
 * override built-ins.
 */

import type { DangerousPattern, PolicyRule, ResolvedGuardrailsConfig } from "./types";

// ── File protection policies ────────────────────────────────────────────────

export const DEFAULT_FILE_POLICIES: PolicyRule[] = [
  {
    id: "secret-files",
    name: "Secret files",
    description: "Files containing environment variables, secrets, or credentials",
    patterns: [
      ".env",
      ".env.local",
      ".env.production",
      ".env.prod",
      ".dev.vars",
      ".netrc",
      ".npmrc",
    ],
    allowedPatterns: [
      "*.example.env",
      "*.sample.env",
      "*.test.env",
      ".env.example",
      ".env.sample",
      ".env.test",
    ],
    protection: "noAccess",
    blockMessage:
      "Accessing {file} is not allowed. This file may contain secrets. " +
      "Explain to the user why you want to access this file, and if changes are needed ask the user to make them.",
  },
  {
    id: "private-keys",
    name: "Private keys and certificates",
    description: "Private key files and certificate bundles",
    patterns: ["*.pem", "*.key", "*.p12", "*.pfx", "*.asc"],
    protection: "noAccess",
    blockMessage:
      "Accessing {file} is not allowed. This file is a private key or certificate and must not be exposed.",
  },
  {
    id: "ssh-keys",
    name: "SSH keys",
    description: "SSH private key files in the home directory",
    patterns: ["~/.ssh/id_rsa", "~/.ssh/id_ed25519", "~/.ssh/id_ecdsa"],
    allowedPatterns: ["~/.ssh/*.pub", "~/.ssh/known_hosts", "~/.ssh/config"],
    protection: "noAccess",
    blockMessage:
      "Accessing {file} is not allowed. This file is an SSH private key and must not be exposed.",
  },
  {
    id: "git-config",
    name: "Git configuration",
    description: "Git configuration containing user identity and remote URLs",
    patterns: [".git/config", ".git-credentials"],
    protection: "readOnly",
    blockMessage:
      "Accessing {file} is not allowed for writing. This file contains repository configuration and should not be modified directly.",
  },
];

// ── Dangerous command patterns ──────────────────────────────────────────────

export const DEFAULT_DANGEROUS_PATTERNS: DangerousPattern[] = [
  { pattern: "rm -rf", description: "recursive force delete" },
  { pattern: "sudo", description: "superuser command" },
  { pattern: "dd of=", description: "disk write operation" },
  { pattern: "mkfs.", description: "filesystem format" },
  { pattern: "chmod -R 777", description: "insecure recursive permissions" },
  { pattern: "chmod --recursive 777", description: "insecure recursive permissions" },
  { pattern: "chown -R", description: "recursive ownership change" },
  { pattern: "shred", description: "secure file overwrite" },
  { pattern: "wipefs", description: "filesystem signature wipe" },
  { pattern: "blkdiscard", description: "block device discard" },
  { pattern: "fdisk", description: "disk partitioning" },
  { pattern: "parted", description: "disk partitioning" },
  { pattern: "docker run --privileged", description: "container with privileged mode" },
  { pattern: "docker run --pid=host", description: "container with host PID namespace" },
];

// ── Auto-deny patterns (always block, no prompt) ────────────────────────────

export const DEFAULT_AUTO_DENY_PATTERNS: string[] = [
  "rm -rf /",
  "rm -rf /*",
  "rm -rf --no-preserve-root",
  "dd if=/dev/zero of=/dev/sd",
  "dd if=/dev/random of=/dev/sd",
  ":(){ :|:& };:", // fork bomb
];

// ── Allowed patterns (always allow) ─────────────────────────────────────────

export const DEFAULT_ALLOWED_PATTERNS: string[] = [
  "rm -rf node_modules",
  "rm -rf .git",
  "rm -rf dist",
  "rm -rf build",
  "rm -rf target",
  "rm -rf .next",
  "rm -rf .turbo",
];

// ── Full resolved config ────────────────────────────────────────────────────

export const DEFAULT_CONFIG: ResolvedGuardrailsConfig = {
  enabled: true,
  features: {
    policies: true,
    permissionGate: true,
  },
  policies: {
    rules: DEFAULT_FILE_POLICIES,
  },
  permissionGate: {
    patterns: DEFAULT_DANGEROUS_PATTERNS,
    useBuiltinMatchers: true,
    requireConfirmation: true,
    allowedPatterns: DEFAULT_ALLOWED_PATTERNS,
    autoDenyPatterns: DEFAULT_AUTO_DENY_PATTERNS,
  },
};
