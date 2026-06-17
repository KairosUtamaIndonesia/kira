/**
 * In-memory grant store for session-scoped permission overrides.
 *
 * Grants allow the user to bypass guardrails for a specific action
 * either once ("allow once") or for the entire session ("allow for session").
 * All grants are cleared on session_shutdown.
 */

import type { Grant, GrantScope } from "./types";

export class GrantStore {
  /** Normalized key → Grant */
  private readonly grants = new Map<string, Grant>();

  /**
   * Normalize an action into a grant key.
   * File grants: "file:<resolved-path>"
   * Command grants: "cmd:<exact-command-text>"
   */
  static fileKey(filePath: string): string {
    return `file:${filePath}`;
  }

  static commandKey(command: string): string {
    return `cmd:${command}`;
  }

  /** Check if a key has been granted. If "once", consume and return true. */
  check(key: string): boolean {
    const grant = this.grants.get(key);
    if (grant === undefined) return false;

    if (grant.scope === "once") {
      this.grants.delete(key);
    }
    return true;
  }

  /** Add a grant for a key. */
  add(key: string, scope: GrantScope): void {
    this.grants.set(key, { key, scope, createdAt: Date.now() });
  }

  /** Clear all grants (called on session_shutdown). */
  clear(): void {
    this.grants.clear();
  }
}
