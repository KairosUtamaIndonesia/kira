import type { SessionData, SessionStore } from "@flue/runtime";

import type { AgentThreadContext } from "./agent-thread-context";

import { readPersistenceBridgeToken, readPersistenceBridgeUrl } from "./env";

type StoredSessionData = {
  sessionData: SessionData;
};

export function createKiraSessionStore(context: AgentThreadContext): SessionStore {
  const bridgeUrl = readPersistenceBridgeUrl();
  const bridgeToken = readPersistenceBridgeToken();

  return {
    async save(id, data) {
      const response = await fetch(flueSessionUrl(bridgeUrl, id), {
        method: "PUT",
        headers: {
          authorization: `Bearer ${bridgeToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          agentThreadId: context.threadId,
          sessionData: data,
        }),
      });
      await requireSuccessfulBridgeResponse(response, "save", id);
    },
    async load(id) {
      const response = await fetch(flueSessionUrl(bridgeUrl, id), {
        method: "GET",
        headers: {
          authorization: `Bearer ${bridgeToken}`,
        },
      });
      await requireSuccessfulBridgeResponse(response, "load", id);
      const stored = (await response.json()) as StoredSessionData | null;
      if (isJsonNull(stored)) {
        return JSON.parse("null") as null;
      }
      return stored.sessionData;
    },
    async delete(id) {
      const response = await fetch(flueSessionUrl(bridgeUrl, id), {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${bridgeToken}`,
        },
      });
      await requireSuccessfulBridgeResponse(response, "delete", id);
    },
  };
}

function isJsonNull(value: unknown): value is null {
  return value === JSON.parse("null");
}

function flueSessionUrl(bridgeUrl: string, storageKey: string) {
  return `${bridgeUrl}/flue-sessions/${encodeURIComponent(storageKey)}`;
}

async function requireSuccessfulBridgeResponse(
  response: Response,
  operation: "save" | "load" | "delete",
  storageKey: string,
) {
  if (response.ok) {
    return;
  }

  const body = await response.text();
  throw new Error(
    `Failed to ${operation} Flue session state for ${storageKey}: HTTP ${response.status} ${body}`,
  );
}
