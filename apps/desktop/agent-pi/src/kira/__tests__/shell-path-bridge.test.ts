/**
 * Tests for the Agent Pi shell path bridge.
 *
 * Verifies that the configured primary shell path flows through:
 *   KIRA_AGENT_SHELL_PATH env var -> readAgentShellPath() -> createAgentSettings() -> getShellPath()
 *
 * The Rust side (primary_shell_path + KIRA_AGENT_SHELL_PATH on the Command)
 * and the tauri.ts dev passthrough are integration concerns tested by their
 * respective suites.  This file proves the contract at the agent-pi boundary
 * by exercising the actual production helper `createAgentSettings`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createAgentSettings } from "../agent-settings";
import { readAgentShellPath } from "../env";

// ---- Env parser ----

describe("readAgentShellPath", () => {
  const KEY = "KIRA_AGENT_SHELL_PATH";
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = original;
    }
  });

  it("returns undefined when env var is not set", () => {
    delete process.env[KEY];
    expect(readAgentShellPath()).toBeUndefined();
  });

  it("returns the path when env var is set", () => {
    process.env[KEY] = "/custom/shell";
    expect(readAgentShellPath()).toBe("/custom/shell");
  });

  it("throws on empty string env var", () => {
    process.env[KEY] = "  ";
    expect(() => readAgentShellPath()).toThrow("KIRA_AGENT_SHELL_PATH must be non-empty when set.");
  });
});

// ---- Production helper ----

describe("createAgentSettings", () => {
  const KEY = "KIRA_AGENT_SHELL_PATH";
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = original;
    }
  });

  it("configures shellPath when KIRA_AGENT_SHELL_PATH is set", () => {
    process.env[KEY] = "/opt/shells/zsh";
    const settings = createAgentSettings();
    expect(settings.getShellPath()).toBe("/opt/shells/zsh");
  });

  it("preserves Pi SDK default (undefined) when KIRA_AGENT_SHELL_PATH is unset", () => {
    delete process.env[KEY];
    const settings = createAgentSettings();
    expect(settings.getShellPath()).toBeUndefined();
  });
});
