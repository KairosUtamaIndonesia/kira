/**
 * Generic Composer slash-command contract.
 *
 * Composer slash commands share one shape regardless of where they originate
 * (Skills, future custom commands, built-in actions). Each command knows how
 * to declare its effect at the Composer boundary — the Composer only owns
 * token detection, autocomplete UX, and submission dispatch.
 *
 * `dispatch` returns one of:
 * - `insert`: replace the command token with `text` and submit the resulting
 *   prompt as a normal user message (used by Skills).
 * - `action`: perform a side effect and clear the token. The action variant
 *   carries a discriminator that names the action; the Composer maps the
 *   discriminator to the runtime call (e.g. `compact` → `session.compact`).
 *   This keeps slash command factories free of hook dependencies and makes
 *   the action surface a closed set the runtime can dispatch.
 */
type ComposerSlashCommandSource = "skill" | "built-in";

/**
 * The outcome of dispatching a slash command at the Composer boundary.
 * Discriminator drives whether the Composer submits a prompt or runs an
 * action and clears the input.
 */
type SlashCommandDispatch =
  | { type: "insert"; text: string }
  | { type: "action"; action: "compact" };

/**
 * A single slash command offered by the Composer.
 */
type ComposerSlashCommand = {
  /** Source kind. Drives iconography and grouping. */
  readonly kind: ComposerSlashCommandSource;
  /** Display name shown in the picker (no leading `/`, no namespace prefix). */
  readonly name: string;
  /**
   * Full invocation the user types to trigger this command, including the
   * leading `/` and any namespace (e.g. `/skill:canon`). The token detector
   * uses this prefix to recognize the command at submit time.
   */
  readonly invocation: string;
  /** Human-readable description shown in autocomplete. */
  readonly description: string;
  /**
   * Compute the command's contribution to the Composer at submit time. Args
   * are the trailing text after the command name, with leading and trailing
   * whitespace removed.
   */
  dispatch: (args: string) => SlashCommandDispatch;
};

export type { ComposerSlashCommand, ComposerSlashCommandSource, SlashCommandDispatch };
