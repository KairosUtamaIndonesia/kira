/**
 * requestOverSocket — request/response over the shared fire-and-forget app socket.
 *
 * The sidecar WS is fire-and-forget (send + broadcast events), but some globals
 * (title / commit-message generation) are logically request/response. This wraps
 * a send plus a correlated event wait into a promise, keyed by the caller's
 * `requestId`. Resolves with the first event `match` accepts; rejects on timeout
 * or abort.
 */

import type { ClientCommand, ServerEvent } from "@kira/agent-pi/protocol";

type SocketSend = (command: ClientCommand) => void;
type SocketSubscribe = (listener: (event: ServerEvent) => void) => () => void;

export type SocketRequestOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export function requestOverSocket<T>(
  send: SocketSend,
  onEvent: SocketSubscribe,
  command: ClientCommand,
  match: (event: ServerEvent) => T | undefined,
  options: SocketRequestOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const signal = options.signal;

  return new Promise<T>((resolve, reject) => {
    if (signal !== undefined && signal.aborted) {
      reject(new Error("Request aborted"));
      return;
    }

    let settled = false;
    const teardown: Array<() => void> = [];

    function cleanup() {
      settled = true;
      for (const fn of teardown) fn();
    }

    function onAbort() {
      if (settled) return;
      cleanup();
      reject(new Error("Request aborted"));
    }

    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort);
      teardown.push(() => signal.removeEventListener("abort", onAbort));
    }

    const unsubscribe = onEvent((event) => {
      if (settled) return;
      const result = match(event);
      if (result !== undefined) {
        cleanup();
        resolve(result);
      }
    });
    teardown.push(unsubscribe);

    const timer = window.setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new Error("Request timed out"));
    }, timeoutMs);
    teardown.push(() => window.clearTimeout(timer));

    send(command);
  });
}
