/**
 * extension-ui-bridge — bridges Pi's ExtensionUIContext to the desktop frontend
 * over the WebSocket transport.
 *
 * Matches the RPC mode pattern: dialog methods (select, confirm, input) send an
 * extension_ui_request event and block until the frontend responds with an
 * extension_ui_response. Fire-and-forget methods (notify) send and return.
 */

import type { WebSocket } from "ws";

import { type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";

import type { ThreadServerEvent } from "../protocol";

// ── Types ───────────────────────────────────────────────────────────

type PendingRequest = {
  resolve: (value: string | boolean | undefined) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

// ── Bridge ──────────────────────────────────────────────────────────

export class ExtensionUIBridge {
  private pending = new Map<string, PendingRequest>();

  /**
   * Create an ExtensionUIContext wired to a WebSocket + threadId.
   * The bridge sends extension_ui_request events scoped to the thread.
   */
  createContext(ws: WebSocket, threadId: string): ExtensionUIContext {
    const send = (event: ThreadServerEvent) => {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify({ type: "thread_event", threadId, event }));
      }
    };

    const dialogPromise = (
      timeout: number | undefined,
      defaultValue: string | boolean | undefined,
      request: Record<string, unknown>,
      parseResponse: (value: string | boolean | undefined) => string | boolean | undefined,
    ): Promise<string | boolean | undefined> => {
      const id = randomUUID();
      return new Promise<string | boolean | undefined>((resolve, reject) => {
        const timer: ReturnType<typeof setTimeout> | undefined =
          timeout !== undefined && timeout > 0
            ? setTimeout(() => {
                this.pending.delete(id);
                resolve(defaultValue);
              }, timeout)
            : undefined;
        this.pending.set(id, { resolve, reject, timer });
        send({ ...request, id, type: "extension_ui_request" } as ThreadServerEvent);
      }).then(parseResponse);
    };

    return {
      select: (title, options, opts) =>
        dialogPromise(
          opts ? opts.timeout : undefined,
          undefined,
          { method: "select", title, options, timeout: opts ? opts.timeout : undefined },
          (r) => (r === undefined ? undefined : String(r)),
        ) as Promise<string | undefined>,

      confirm: (title, message, opts) =>
        dialogPromise(
          opts ? opts.timeout : undefined,
          false,
          { method: "confirm", title, message, timeout: opts ? opts.timeout : undefined },
          (r) => r === true,
        ) as Promise<boolean>,

      input: (title, placeholder, opts) =>
        dialogPromise(
          opts ? opts.timeout : undefined,
          undefined,
          { method: "input", title, placeholder, timeout: opts ? opts.timeout : undefined },
          (r) => (r === undefined ? undefined : String(r)),
        ) as Promise<string | undefined>,

      notify(message, type) {
        send({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          ...(type !== undefined ? { notifyType: type } : {}),
        } as ThreadServerEvent);
      },

      // ── No-ops (matching RPC mode) ──────────────────────────────
      /* eslint-disable @typescript-eslint/no-empty-function, unicorn/no-useless-undefined */

      onTerminalInput: () => () => {},
      setStatus: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: () => {},
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
      custom: async () => undefined as never,
      pasteToEditor: () => {},
      setEditorText: () => {},
      getEditorText: () => "",
      editor: async () => undefined,
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() {
        return undefined as never;
      },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Not supported in WebSocket mode" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
      /* eslint-enable @typescript-eslint/no-empty-function, unicorn/no-useless-undefined */
    };
  }

  /**
   * Resolve a pending extension UI request with the frontend's response.
   * Called when an extension_ui_response command arrives.
   */
  resolve(
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);

    if (response.cancelled) {
      pending.resolve(undefined); // eslint-disable-line unicorn/no-useless-undefined
    } else if (response.confirmed !== undefined) {
      pending.resolve(response.confirmed);
    } else if (response.value !== undefined) {
      pending.resolve(response.value);
    } else {
      pending.resolve(undefined); // eslint-disable-line unicorn/no-useless-undefined
    }
  }

  /**
   * Reject all pending requests (e.g. on thread close).
   */
  rejectAll(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Thread closed"));
    }
    this.pending.clear();
  }
}
