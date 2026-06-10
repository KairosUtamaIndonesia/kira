import { Hono } from "hono";

import { getOrCreateAgentSession } from "./agent-session-host";
import { registerAgentThreadContext, requireAgentThreadContext } from "./agent-thread-context";
import { requireRuntimeToken } from "./auth";
import { generateAgentThreadTitle } from "./title-generation";

const appRoutes = new Hono();

appRoutes.use("/*", requireRuntimeToken);

appRoutes.get("/skills", (context) => context.json({ skills: [] }));

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
    return context.json({ messages: host.session.messages, sessionId: host.session.sessionId });
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

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
