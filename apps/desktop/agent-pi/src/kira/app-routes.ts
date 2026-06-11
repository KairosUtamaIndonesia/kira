import { Hono } from "hono";
import { readFileSync } from "node:fs";

import { getOrCreateAgentSession } from "./agent-session-host";
import {
  listAgentThreadContexts,
  registerAgentThreadContext,
  requireAgentThreadContext,
} from "./agent-thread-context";
import { requireRuntimeToken } from "./auth";
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
    const contextUsage = contextUsageFromEntries(await host.session.sessionManager.getEntries());
    return context.json({
      messages: host.session.messages,
      sessionId: host.session.sessionId,
      contextUsage:
        contextUsage === undefined
          ? undefined
          : { ...contextUsage, updatedAt: new Date().toISOString() },
    });
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
