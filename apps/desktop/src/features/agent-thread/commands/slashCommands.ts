/**
 * Generic Composer slash-command contract.
 *
 * Composer slash commands share one shape regardless of where they originate
 * (Skills, future custom commands, etc.). Each command knows how to expand its
 * invocation text into the prompt body — the Composer only owns token
 * detection, autocomplete UX, and submit-time expansion.
 *
 * Expansion is composition-time work: the Composer replaces the command token
 * (and any trailing args) with the expanded text before the prompt is sent.
 */

type ComposerSlashCommandSource = "skill";

/**
 * A single slash command offered by the Composer.
 */
type ComposerSlashCommand = {
  /** Source kind. Drives dispatch and how the command is presented. */
  readonly kind: ComposerSlashCommandSource;
  /** Display name shown in the picker (no leading `/`, no namespace prefix). */
  readonly name: string;
  /**
   * Full invocation the user types to trigger this command, including the
   * leading `/` and any namespace (e.g. `/skill:canon`). The submit-time
   * expander uses this to match typed text.
   */
  readonly invocation: string;
  /** Human-readable description shown in autocomplete. */
  readonly description: string;
  /**
   * Replace the invocation text (e.g. `/skill:canon fix this`) with the
   * command's contribution to the prompt. Args are the trailing text after
   * the command name, with leading/trailing whitespace removed.
   */
  expand: (args: string) => string;
};

export type { ComposerSlashCommand, ComposerSlashCommandSource };
