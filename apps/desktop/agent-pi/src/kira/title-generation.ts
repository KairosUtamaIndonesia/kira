import type { AssistantMessage } from "@earendil-works/pi-ai";

import {
  AgentHarness,
  Session,
  SessionError,
  type SessionMetadata,
  type SessionStorage,
  type SessionTreeEntry,
  uuidv7,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

import { readAgentProviderApiKey } from "./env";
import { getDefaultModel } from "./model-catalog";
import { piModelFromConfig } from "./pi-model";

const TITLE_SYSTEM_PROMPT = [
  "You generate concise titles for Kira Agent Threads.",
  "Return only the title text. No quotes, no markdown, no punctuation flourish.",
  "Use 3 to 7 words. Prefer specific nouns and verbs from the user's request.",
].join("\n");

type GenerateAgentThreadTitleInput = {
  projectPath: string;
  prompt: string;
  assistantText: string;
};

type GenerateAgentThreadTitleOutput = {
  title: string;
};

async function generateAgentThreadTitle(
  input: GenerateAgentThreadTitleInput,
): Promise<GenerateAgentThreadTitleOutput> {
  const apiKey = readAgentProviderApiKey();
  if (apiKey === undefined) {
    throw new Error("KIRA_AGENT_PROVIDER_API_KEY must be set to generate Agent Thread titles.");
  }

  const harness = new AgentHarness({
    env: new NodeExecutionEnv({ cwd: input.projectPath }),
    session: new Session(new EphemeralSessionStorage(`title-${uuidv7()}`)),
    model: piModelFromConfig(getDefaultModel()),
    tools: [],
    systemPrompt: TITLE_SYSTEM_PROMPT,
    getApiKeyAndHeaders: async () => ({ apiKey }),
  });

  const response = await harness.prompt(titlePrompt(input));
  const title = normalizeTitle(assistantText(response));
  if (title.length === 0) {
    throw new Error("The title generator returned an empty title.");
  }
  return { title };
}

class EphemeralSessionStorage implements SessionStorage {
  private readonly metadata: SessionMetadata;
  private readonly entries: SessionTreeEntry[] = [];
  private readonly byId = new Map<string, SessionTreeEntry>();
  private leafId: string | null = JSON.parse("null") as null;

  constructor(id: string) {
    this.metadata = { id, createdAt: new Date().toISOString() };
  }

  async getMetadata(): Promise<SessionMetadata> {
    return this.metadata;
  }

  async getLeafId(): Promise<string | null> {
    return this.leafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId)) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    this.leafId = leafId;
  }

  async createEntryId(): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = uuidv7().slice(0, 8);
      if (!this.byId.has(id)) {
        return id;
      }
    }
    return uuidv7();
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.type === "leaf" ? entry.targetId : entry.id;
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

  async getLabel(_id: string): Promise<string | undefined> {
    return;
  }

  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    if (leafId === null) {
      return [];
    }
    const path: SessionTreeEntry[] = [];
    let current = this.byId.get(leafId);
    if (current === undefined) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    while (current !== undefined) {
      path.unshift(current);
      if (current.parentId === undefined || current.parentId === null) {
        break;
      }
      const parent = this.byId.get(current.parentId);
      if (parent === undefined) {
        throw new SessionError("invalid_session", `Entry ${current.parentId} not found`);
      }
      current = parent;
    }
    return path;
  }

  async getEntries(): Promise<SessionTreeEntry[]> {
    return [...this.entries];
  }
}

function titlePrompt(input: GenerateAgentThreadTitleInput) {
  return [
    "Create a short title for this Agent Thread.",
    "",
    "User prompt:",
    input.prompt,
    "",
    "Assistant response:",
    input.assistantText,
  ].join("\n");
}

function assistantText(message: AssistantMessage) {
  const parts: string[] = [];
  for (const content of message.content) {
    if (content.type === "text") {
      parts.push(content.text);
    }
  }
  return parts.join("");
}

function normalizeTitle(value: string) {
  return value
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
}

export { generateAgentThreadTitle };
export type { GenerateAgentThreadTitleInput, GenerateAgentThreadTitleOutput };
