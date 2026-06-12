/**
 * User-message blocks.
 *
 * A user message can mix plain text and slash-skill expansion. When the user
 * types `/skill:canon fix this`, the agent-pi transport unwraps the invocation
 * into a Pi-compatible `<skill>…</skill>` block plus the trailing args. The
 * Composer also keeps that expanded form when it echoes the message back into
 * the transcript, so the local renderer can show a collapsible skill chip
 * instead of dumping the entire body inline.
 */
type UserMessageBlock =
  | { type: "text"; text: string }
  | { type: "skill"; name: string; location: string | undefined; body: string };

/**
 * Split a literal user message into a list of text + skill blocks. The pattern
 * matches the `<skill name="…">…</skill>` shape produced by
 * `_expandSkillCommand` in pi-coding-agent. The `location` attribute is
 * optional so the parser accepts blocks produced by the desktop expansion,
 * which may not have a path on hand.
 */
function parseUserMessageBlocks(text: string): UserMessageBlock[] {
  const pattern = /<skill\s+name="([^"]+)"(?:\s+location="([^"]*)")?>\n([\s\S]*?)\n<\/skill>/g;
  const blocks: UserMessageBlock[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    if (match.index > cursor) {
      const before = text.slice(cursor, match.index);
      blocks.push({ type: "text", text: before });
    }
    const location = match[2];
    blocks.push({
      type: "skill",
      name: match[1] ?? "",
      location: location === undefined || location.length === 0 ? undefined : location,
      body: (match[3] ?? "").trim(),
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    blocks.push({ type: "text", text: text.slice(cursor) });
  }
  return blocks;
}

export { parseUserMessageBlocks };
export type { UserMessageBlock };
