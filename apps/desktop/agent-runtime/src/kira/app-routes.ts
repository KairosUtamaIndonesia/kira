import { Hono } from "hono";

import { registerAgentThreadContext } from "./agent-thread-context";
import { requireRuntimeToken } from "./auth";

const appRoutes = new Hono();

appRoutes.use("/*", requireRuntimeToken);

appRoutes.post("/agent-threads", async (context) => {
  const payload = await context.req.json();
  const agentThreadContext = parseAgentThreadContext(payload);
  registerAgentThreadContext(agentThreadContext);
  return context.json({ status: "registered", threadId: agentThreadContext.threadId });
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

function requireRecord(value: unknown, label: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }

  return value;
}

export { appRoutes };
