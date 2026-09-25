/**
 * What a reconstruction reads.
 *
 * A flat, pi-free account of a chat: who spoke, what they said, and which tools
 * Kira reached for. pi's own message shapes are flattened into this by the one
 * module that knows them, so that everything worked out of a conversation — the
 * goal, the files, the commits, the things the person asked for — is a pure
 * function of a list of these and can be read and tested without a session.
 */

/** A tool Kira reached for during a turn. */
export interface ToolUse {
  name: string;
  /**
   * The file it was aimed at, when the tool names one.
   *
   * Whatever the tool was handed, unread: a `:12` line suffix, quotes around it,
   * a path outside the chat's folder. Cleaning that up belongs to the code that
   * reads the files out, not to the code that knows pi's tool arguments.
   */
  path?: string;
}

/** One thing that was said, as the reconstruction reads it. */
export type Turn =
  | { speaker: 'person'; text: string }
  | { speaker: 'kira'; text: string; tools?: readonly ToolUse[] }
  | { speaker: 'tool'; text: string };

/** Who said a thing that was carried forward. */
export type Speaker = Turn['speaker'];

/**
 * The kinds of part a message can be read for.
 *
 * A turn is what was said; a part is what it was made of. The transcript and the
 * summary want the first, and someone asking to see a turn again may want either
 * — the reasoning behind an answer, or the whole of a file a tool read — none of
 * which survives being flattened into words.
 */
export type PartKind = 'text' | 'thinking' | 'toolCall' | 'toolResult';

/**
 * One piece of a message.
 *
 * `callId` is what pairs a tool's answer with the call that asked for it: a call
 * is on the turn that reached for the tool, and its result is usually on the turn
 * after, so nothing but this identifier relates them.
 */
export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'toolCall'; callId: string; name: string; text: string; path?: string }
  | { kind: 'toolResult'; callId: string; name: string; text: string; failed: boolean };
