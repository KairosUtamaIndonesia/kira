import { Hono } from "hono";
import { readFileSync } from "node:fs";

import { getOrCreateAgentSession } from "./agent-session-host";
import {
  listAgentThreadContexts,
  registerAgentThreadContext,
  requireAgentThreadContext,
} from "./agent-thread-context";
import { requireRuntimeToken } from "./auth";
import { generateCommitMessage } from "./commit-message-generation";
import { contextUsageFromEntries } from "./context-usage";
import { generateAgentThreadTitle } from "./title-generation";

const appRoutes = new Hono();

appRoutes.use("/*", requireRuntimeToken);

type SkillListItem = {
  name: string;
  description: string;
  body: string;
};

appRoutes.get("/skills", async (context) => {
  const skills = await listBundledSkills();
  return context.json({ skills });
});

appRoutes.get("/skills/:name/body", async (context) => {
  const name = context.req.param("name");
  if (name === undefined || name.length === 0) {
    return context.json({ error: "Skill name is required." }, 400);
  }
  const skills = await listBundledSkills();
  const match = skills.find((skill) => skill.name === name);
  if (match === undefined) {
    return context.json({ error: `Unknown bundled skill: ${name}` }, 404);
  }
  return context.json({ name: match.name, body: match.body });
});

async function listBundledSkills(): Promise<SkillListItem[]> {
  // Bundled Skills are identical across Agent Threads, so the first resource
  // loader that exposes them is enough. Try the registered Agent Threads in
  // parallel; the first one that succeeds wins.
  const attempts = await Promise.allSettled(
    listAgentThreadContexts().map(async (threadContext) => {
      const host = await getOrCreateAgentSession(threadContext);
      const loaded = host.session.resourceLoader.getSkills().skills;
      return loaded.map<SkillListItem>((skill) => ({
        name: skill.name,
        description: skill.description,
        body: readSkillBody(skill.filePath),
      }));
    }),
  );
  for (const attempt of attempts) {
    if (attempt.status === "fulfilled") {
      return attempt.value;
    }
  }
  return [];
}

function readSkillBody(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    return stripFrontmatter(content).trim();
  } catch {
    return "";
  }
}

function stripFrontmatter(content: string): string {
  const altPrefix = "---\r\n";
  const prefix = "---\n";
  let rest: string;
  if (content.startsWith(altPrefix)) {
    rest = content.slice(altPrefix.length);
  } else if (content.startsWith(prefix)) {
    rest = content.slice(prefix.length);
  } else {
    return content;
  }
  let searchFrom = 0;
  while (searchFrom < rest.length) {
    const rel = rest.indexOf("\n---", searchFrom);
    if (rel < 0) {
      return content;
    }
    const afterClose = rest.slice(rel + 4);
    if (afterClose.length === 0 || afterClose.startsWith("\n") || afterClose.startsWith("\r\n")) {
      return afterClose;
    }
    searchFrom = rel + 4;
  }
  return content;
}

appRoutes.post("/agent-threads", async (context) => {
  const payload = await context.req.json();
  const agentThreadContext = parseAgentThreadContext(payload);
  registerAgentThreadContext(agentThreadContext);
  return context.json({ status: "registered", threadId: agentThreadContext.threadId });
});

appRoutes.get("/agent-threads/:threadId/session", async (context) => {
  try {
    const threadId = context.req.param("threadId");
    const agentThreadContext = requireAgentThreadContext(threadId);
    const host = await getOrCreateAgentSession(agentThreadContext);
    const entries = await host.session.sessionManager.getEntries();
    const contextUsage = contextUsageFromEntries(entries);
    const latestCompaction = entries.findLast((entry) => entry.type === "compaction") as
      | { summary?: string; tokensBefore?: number }
      | undefined;
    return context.json({
      messages: host.session.messages,
      sessionId: host.session.sessionId,
      contextUsage:
        contextUsage === undefined
          ? undefined
          : { ...contextUsage, updatedAt: new Date().toISOString() },
      compaction:
        latestCompaction !== undefined &&
        typeof latestCompaction.summary === "string" &&
        typeof latestCompaction.tokensBefore === "number"
          ? { summary: latestCompaction.summary, tokensBefore: latestCompaction.tokensBefore }
          : undefined,
    });
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

type SessionTreeNodeJson = {
  id: string;
  parentId: string | undefined;
  entry: {
    type: string;
    role?: string;
    text?: string;
    toolName?: string;
    timestamp?: string;
    label?: string;
    messageId?: string;
  };
  children: SessionTreeNodeJson[];
};

appRoutes.get("/agent-threads/:threadId/tree", async (context) => {
  try {
    const threadId = context.req.param("threadId");
    const agentThreadContext = requireAgentThreadContext(threadId);
    const host = await getOrCreateAgentSession(agentThreadContext);
    const tree = host.session.sessionManager.getTree();
    const currentLeafId = host.session.sessionManager.getLeafId();
    const nodes = tree.map(serializeSessionTreeNode);
    return context.json({ nodes, currentLeafId });
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

function serializeSessionTreeNode(raw: unknown): SessionTreeNodeJson {
  const node = raw as Record<string, unknown>;
  const entry = node.entry as Record<string, unknown> | undefined;
  if (entry === undefined) {
    return { id: "unknown", parentId: undefined, entry: { type: "unknown" }, children: [] };
  }

  let role: string | undefined;
  let text: string | undefined;
  let toolName: string | undefined;
  let messageId: string | undefined;

  if (entry.type === "message") {
    const msg = entry.message as Record<string, unknown> | undefined;
    if (msg !== undefined) {
      const msgRole = msg.role;
      if (msgRole === "user" || msgRole === "assistant") {
        role = msgRole;
      }
      if (typeof msg.id === "string") {
        messageId = msg.id;
      } else if (typeof msg.responseId === "string") {
        messageId = msg.responseId;
      } else if (
        typeof msg.role === "string" &&
        (typeof msg.timestamp === "string" || typeof msg.timestamp === "number")
      ) {
        messageId = `message:${msg.role as string}:${String(msg.timestamp)}`;
      }
      text = extractMessagePreview(msg);
      const toolCalls = msg.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        const first = toolCalls[0] as Record<string, unknown>;
        const fn = first.function as Record<string, unknown> | undefined;
        if (fn !== undefined && typeof fn.name === "string") {
          toolName = fn.name;
        }
      }
      const toolResults = msg.tool_results;
      if (Array.isArray(toolResults) && toolResults.length > 0) {
        const firstResult = toolResults[0] as Record<string, unknown>;
        if (typeof firstResult.tool_name === "string") {
          toolName = firstResult.tool_name;
        } else if (typeof firstResult.name === "string") {
          toolName = firstResult.name;
        }
      }
    }
  }

  if (entry.type === "compaction") {
    text =
      typeof (entry as Record<string, unknown>).summary === "string"
        ? ((entry as Record<string, unknown>).summary as string)
        : undefined;
  }

  const entryOut: SessionTreeNodeJson["entry"] = { type: entry.type as string };
  if (messageId !== undefined) entryOut.messageId = messageId;
  if (role !== undefined) entryOut.role = role;
  if (text !== undefined) entryOut.text = text.slice(0, 200);
  if (toolName !== undefined) entryOut.toolName = toolName;
  if (typeof entry.timestamp === "string") entryOut.timestamp = entry.timestamp;
  if (typeof node.label === "string") entryOut.label = node.label;

  const children = Array.isArray(node.children) ? node.children : [];

  return {
    id: typeof entry.id === "string" ? entry.id : "unknown",
    parentId: typeof entry.parentId === "string" ? entry.parentId : undefined,
    entry: entryOut,
    children: children.map((child: unknown) => serializeSessionTreeNode(child)),
  };
}

function extractMessagePreview(msg: Record<string, unknown>): string | undefined {
  const content = msg.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as Record<string, unknown>).type === "text"
      ) {
        const text = (part as Record<string, unknown>).text;
        if (typeof text === "string") {
          parts.push(text);
        }
      }
    }
    return parts.join(" ").trim();
  }
  if (typeof content === "string") {
    return content.trim();
  }
  return undefined;
}

appRoutes.post("/agent-thread-title", async (context) => {
  try {
    const payload = await context.req.json();
    const titleInput = parseAgentThreadTitleInput(payload);
    const title = await generateAgentThreadTitle(titleInput);
    return context.json(title);
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

appRoutes.post("/generate-commit-message", async (context) => {
  try {
    const payload = await context.req.json();
    const record = requireRecord(payload, "commit message input");
    const stagedDiff = requireString(record.stagedDiff, "stagedDiff");
    const recentLog = requireString(record.recentLog, "recentLog");
    const result = await generateCommitMessage({ stagedDiff, recentLog });
    if ("error" in result) {
      return context.json(result, 400);
    }
    return context.json(result);
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

function parseAgentThreadContext(value: unknown) {
  const record = requireRecord(value, "Agent Thread context");
  return {
    projectId: requireString(record.projectId, "projectId"),
    sessionId: requireString(record.sessionId, "sessionId"),
    threadId: requireString(record.threadId, "threadId"),
    projectPath: requireString(record.projectPath, "projectPath"),
  };
}

function parseAgentThreadTitleInput(value: unknown) {
  const record = requireRecord(value, "Agent Thread title input");
  return {
    projectPath: requireString(record.projectPath, "projectPath"),
    prompt: requireString(record.prompt, "prompt"),
    assistantText: requireString(record.assistantText, "assistantText"),
  };
}
function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }

  return value;
}

export { appRoutes };
