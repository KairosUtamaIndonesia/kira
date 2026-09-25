import type { ChatMessage } from '../../preload/bridge';

/**
 * Which drawn messages get the row of actions under them, by id.
 *
 * A turn is stored one entry per step, so what Kira thought and ran reaches the
 * window as a message of its own, before the message that says what came of it.
 * The actions — ask again, fork — belong to the turn, so they go under the
 * words they act on; the step above would be the same buttons twice. A step
 * that nothing follows keeps its row, because then it is the only place its
 * turn can be acted on.
 */
export function messagesShowingActions(messages: readonly ChatMessage[]): Set<string> {
  const ids = new Set<string>();

  messages.forEach((message, index) => {
    const carriesWords = message.parts.some((part) => part.type === 'text');
    const wordsStillComing = messages[index + 1]?.role === 'kira';

    if (carriesWords || !wordsStillComing) {
      ids.add(message.id);
    }
  });

  return ids;
}
