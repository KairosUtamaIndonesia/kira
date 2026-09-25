import type { ChatMessage, ChatPart } from '../../preload/bridge';

/**
 * Collect the reasoning and tools before an assistant starts its answer into
 * one visible disclosure. Keep the underlying message tree untouched.
 */
export function workPartsByMessage(
  messages: readonly ChatMessage[],
): Map<string, readonly ChatPart[]> {
  const visible = new Map(
    messages.map((message) => [
      message.id,
      message.parts.map((part) =>
        part.type === 'work' ? { ...part, calls: [...part.calls] } : part,
      ),
    ]),
  );
  let group: Extract<ChatPart, { type: 'work' }> | null = null;

  for (const message of messages) {
    if (message.role === 'you') {
      group = null;
      continue;
    }

    const parts = visible.get(message.id);
    if (!parts) continue;

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part) continue;

      if (part.type === 'text') {
        group = null;
        break;
      }
      if (part.type !== 'work') continue;

      if (group === null) {
        group = part;
        continue;
      }

      group.reasoning = [group.reasoning, part.reasoning].filter(Boolean).join('\n\n') || null;
      group.calls.push(...part.calls);
      const elapsed = group.calls.flatMap((call) =>
        call.durationMs === null ? [] : [call.durationMs],
      );
      group.durationMs = elapsed.length === 0 ? null : elapsed.reduce((sum, ms) => sum + ms, 0);
      parts.splice(index, 1);
      index -= 1;
    }
  }

  return visible;
}
