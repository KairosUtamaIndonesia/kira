import type { ChatMessage, ModelOption } from '../../preload/bridge';
import { formatDuration } from './chatTiming.ts';

/** The name the pool gives a model, or its id when the pool no longer offers it. */
export function modelName(models: readonly ModelOption[], id: string): string {
  return models.find((model) => model.id === id)?.name ?? id;
}

/** A reply's timestamp as a clock reading, in the reader's own locale. */
export function formatClockTime(at: number, locale?: string): string {
  return new Date(at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/**
 * What a reply was written with, read as one line beside its actions: the model,
 * how long the turn took, and when it finished. A part that is not known is left
 * out rather than drawn empty, so the line says less instead of saying "null".
 */
export function formatReplyMeta(reply: {
  model: string | null;
  durationMs: number | null;
  at: number;
}): string | null {
  const bits = [
    reply.model,
    reply.durationMs === null ? null : formatDuration(reply.durationMs),
    formatClockTime(reply.at),
  ].filter((bit): bit is string => bit !== null && bit !== '');

  return bits.length === 0 ? null : bits.join(' · ');
}

/** Each reply's metadata line, by message id, for the messages that carry one. */
export function replyMetaByMessage(
  messages: readonly ChatMessage[],
  models: readonly ModelOption[],
): Map<string, string> {
  const meta = new Map<string, string>();

  for (const message of messages) {
    if (message.reply === undefined) continue;

    const line = formatReplyMeta({
      model: message.reply.model === null ? null : modelName(models, message.reply.model),
      durationMs: message.reply.durationMs,
      at: message.reply.at,
    });

    if (line !== null) meta.set(message.id, line);
  }

  return meta;
}
