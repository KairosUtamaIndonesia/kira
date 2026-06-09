import { Hono } from "hono";

import { registerAgentThreadContext } from "./agent-thread-context";
import { requireRuntimeToken } from "./auth";
import { bundledSkillSummaries } from "./bundled-skills";
import { deliverHumanResponse } from "./human-in-the-loop";

const appRoutes = new Hono();

appRoutes.use("/*", requireRuntimeToken);

appRoutes.get("/skills", (context) => context.json({ skills: bundledSkillSummaries() }));

appRoutes.post("/agent-threads", async (context) => {
  const payload = await context.req.json();
  const agentThreadContext = parseAgentThreadContext(payload);
  registerAgentThreadContext(agentThreadContext);
  return context.json({ status: "registered", threadId: agentThreadContext.threadId });
});

appRoutes.post("/agent-threads/:threadId/human-response", async (context) => {
  const threadId = context.req.param("threadId");
  if (threadId.trim().length === 0) {
    return context.json({ error: "threadId is required." }, 400);
  }

  let payload: unknown;
  try {
    payload = await context.req.json();
  } catch {
    return context.json({ error: "Request body must be valid JSON." }, 400);
  }
  if (typeof payload !== "object" || payload === null || !("response" in payload)) {
    return context.json({ error: "Request body must include a 'response' field." }, 400);
  }

  const result = deliverHumanResponse(threadId, (payload as { response: unknown }).response);
  switch (result.status) {
    case "delivered":
      return context.json({ status: "delivered" });
    case "none-pending":
      return context.json(
        { error: "No human input request is pending for this Agent Thread." },
        409,
      );
    case "invalid":
      return context.json({ error: result.reason }, 422);
    default:
      return exhaustiveDeliverResult(result);
  }
});

function exhaustiveDeliverResult(result: never): never {
  throw new Error(`Unhandled human response delivery result: ${JSON.stringify(result)}`);
}

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
