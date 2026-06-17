/**
 * Interactive prompt handler for the Guardrails extension.
 *
 * Uses ctx.ui.select() for confirmation prompts — works in both TUI and
 * headless/WebSocket modes.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { PromptOptions } from "../types";

export type ConfirmChoice = "allow" | "allow-session" | "deny";

/**
 * Present a confirmation prompt to the user.
 * Returns the user's choice, or undefined if the prompt failed.
 */
export async function promptConfirm(
  ctx: ExtensionContext,
  opts: PromptOptions,
): Promise<ConfirmChoice | undefined> {
  const question = [
    `⚠️  Guardrails: ${opts.label}`,
    `Target: ${opts.target}`,
    `Reason: ${opts.reason}`,
    "",
    "Allow this action?",
  ].join("\n");

  try {
    const result = await ctx.ui.select(question, ["Allow once", "Allow for session", "Deny"]);
    if (result === "Allow once") return "allow";
    if (result === "Allow for session") return "allow-session";
    if (result === "Deny") return "deny";
    return undefined;
  } catch {
    return undefined;
  }
}
