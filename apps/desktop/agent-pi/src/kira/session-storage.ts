import {
  type LeafEntry,
  SessionError,
  type SessionMetadata,
  type SessionStorage,
  type SessionTreeEntry,
  uuidv7,
} from "@earendil-works/pi-agent-core";

import { contextUsageFromEntries } from "./context-usage";

const SNAPSHOT_VERSION = 1;

/**
 * Opaque blob stored in `flue_agent_session_state.session_data_json` via the
 * Rust persistence bridge. The Rust side never inspects this; it round-trips
 * the JSON verbatim, so the shape is owned entirely here.
 */
type StorageSnapshot = {
  version: number;
  metadata: SessionMetadata;
  entries: SessionTreeEntry[];
};

type BridgeConfig = {
  url: string;
  token: string;
  /** Session-tree storage key (one row per Agent Thread session). */
  storageKey: string;
  agentThreadId: string;
};

function generateEntryId(byId: Map<string, SessionTreeEntry>): string {
  for (let i = 0; i < 100; i += 1) {
    const id = uuidv7().slice(0, 8);
    if (!byId.has(id)) {
      return id;
    }
  }
  return uuidv7();
}

/** The active leaf after appending `entry`: a leaf entry redirects, others advance to themselves. */
function leafIdAfterEntry(entry: SessionTreeEntry): string | null {
  return entry.type === "leaf" ? entry.targetId : entry.id;
}

function updateLabelCache(labelsById: Map<string, string>, entry: SessionTreeEntry): void {
  if (entry.type !== "label") {
    return;
  }
  const label = entry.label === undefined ? undefined : entry.label.trim();
  if (label) {
    labelsById.set(entry.targetId, label);
  } else {
    labelsById.delete(entry.targetId);
  }
}

/**
 * `SessionStorage` backed by Kira's Rust SQLite persistence bridge.
 *
 * Reads and tree navigation operate against an in-memory entry tree (cloned
 * from pi's `InMemorySessionStorage` semantics). Every mutation snapshots the
 * full entry set and PUTs it to the bridge — keeping Rust the owner of the
 * persisted transcript (ADR-0001) while staying within pi's pluggable storage
 * interface. The bridge treats the snapshot as an opaque blob.
 */
export class BridgeSessionStorage implements SessionStorage {
  private readonly metadata: SessionMetadata;
  private entries: SessionTreeEntry[];
  private byId: Map<string, SessionTreeEntry>;
  private labelsById: Map<string, string>;
  private leafId: string | null;

  private constructor(
    snapshot: StorageSnapshot,
    private readonly bridge: BridgeConfig,
  ) {
    this.metadata = snapshot.metadata;
    this.entries = [...snapshot.entries];
    this.byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    this.labelsById = new Map();
    this.leafId = JSON.parse("null") as null;
    for (const entry of this.entries) {
      updateLabelCache(this.labelsById, entry);
      this.leafId = leafIdAfterEntry(entry);
    }
    if (this.leafId !== null && !this.byId.has(this.leafId)) {
      throw new SessionError("invalid_session", `Entry ${this.leafId} not found`);
    }
  }

  /** Load the persisted snapshot for `storageKey` (or start empty) and bind it to the bridge. */
  static async open(bridge: BridgeConfig): Promise<BridgeSessionStorage> {
    const response = await fetch(sessionUrl(bridge), {
      headers: { authorization: `Bearer ${bridge.token}` },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to load session state for ${bridge.storageKey}: HTTP ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { sessionData: StorageSnapshot } | null;
    const snapshot: StorageSnapshot =
      body === null
        ? {
            version: SNAPSHOT_VERSION,
            metadata: { id: bridge.storageKey, createdAt: new Date().toISOString() },
            entries: [],
          }
        : body.sessionData;
    return new BridgeSessionStorage(snapshot, bridge);
  }

  async getMetadata(): Promise<SessionMetadata> {
    return this.metadata;
  }

  async getLeafId(): Promise<string | null> {
    if (this.leafId !== null && !this.byId.has(this.leafId)) {
      throw new SessionError("invalid_session", `Entry ${this.leafId} not found`);
    }
    return this.leafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId)) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    const entry: LeafEntry = {
      type: "leaf",
      id: generateEntryId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      targetId: leafId,
    };
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = leafId;
    await this.persist();
  }

  async createEntryId(): Promise<string> {
    return generateEntryId(this.byId);
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    updateLabelCache(this.labelsById, entry);
    this.leafId = leafIdAfterEntry(entry);
    await this.persist();
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.byId.get(id);
  }

  async findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    return this.entries.filter(
      (entry): entry is Extract<SessionTreeEntry, { type: TType }> => entry.type === type,
    );
  }

  async getLabel(id: string): Promise<string | undefined> {
    return this.labelsById.get(id);
  }

  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    if (leafId === null) {
      return [];
    }
    const path: SessionTreeEntry[] = [];
    let current = this.byId.get(leafId);
    if (!current) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    while (current) {
      path.unshift(current);
      if (!current.parentId) {
        break;
      }
      const parent = this.byId.get(current.parentId);
      if (!parent) {
        throw new SessionError("invalid_session", `Entry ${current.parentId} not found`);
      }
      current = parent;
    }
    return path;
  }

  async getEntries(): Promise<SessionTreeEntry[]> {
    return [...this.entries];
  }

  private async persist(): Promise<void> {
    const sessionData: StorageSnapshot = {
      version: SNAPSHOT_VERSION,
      metadata: this.metadata,
      entries: this.entries,
    };
    const response = await fetch(sessionUrl(this.bridge), {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.bridge.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agentThreadId: this.bridge.agentThreadId,
        contextUsage: contextUsageFromEntries(this.entries),
        sessionData,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to persist session state for ${this.bridge.storageKey}: HTTP ${response.status} ${await response.text()}`,
      );
    }
  }
}

function sessionUrl(bridge: BridgeConfig): string {
  return `${bridge.url}/flue-sessions/${encodeURIComponent(bridge.storageKey)}`;
}

export type { BridgeConfig };
