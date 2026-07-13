/**
 * Memory Extension
 *
 * Persistent memory, session search, and learning loop for Kira.

 *
 * 1. Persistent Memory — MEMORY.md + USER.md that survive across sessions
 * 2. Background Learning Loop — auto-saves notable facts every N turns
 * 3. Session-End Flush — saves memories before compaction/shutdown
 * 4. Auto-Consolidation — merges memory when full instead of erroring
 * 5. Correction Detection — immediate save on user corrections
 * 6. Procedural Skills — SKILL.md files for reusable procedures
 * 7. Tool-Call-Aware Nudge — review triggers on tool call count too
 * 8. /memory-insights — shows what's stored
 * 9. /memory-skills — lists procedural skills
 * 10. /memory-consolidate — manual consolidation trigger
 * 11. /memory-interview — onboarding interview to pre-fill user profile
 * 12. /memory-switch-project — list project memories
 * 13. Context Fencing — <memory-context> tags prevent injection through stored memory
 * 14. Memory Aging — entry timestamps guide consolidation
 *
 *
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import * as path from "node:path";

import { getCurrentProjectId } from "../../agent-thread-context.js";
import { authStorage, modelRegistry } from "../../model-registry.js";
import { loadConfig } from "./config.js";
import { triggerConsolidation, registerConsolidateCommand } from "./handlers/auto-consolidate.js";
import { setupBackgroundReview } from "./handlers/background-review.js";
import { setupCorrectionDetector } from "./handlers/correction-detector.js";
import { registerIndexSessionsCommand } from "./handlers/index-sessions.js";
import { registerInsightsCommand } from "./handlers/insights.js";
import { registerInterviewCommand } from "./handlers/interview.js";
import { registerLearnMemoryCommand } from "./handlers/learn-memory.js";
import { registerPreviewContextCommand } from "./handlers/preview-context.js";
import { setupSessionFlush } from "./handlers/session-flush.js";
import { registerSkillsCommand } from "./handlers/skills-command.js";
import { registerSwitchProjectCommand } from "./handlers/switch-project.js";
import { registerSyncMarkdownMemoriesCommand } from "./handlers/sync-markdown-memories.js";
import { getAgentRoot } from "./paths.js";
import { detectProject, detectProjectSkills } from "./project.js";
import { buildPromptContext, buildSessionContext } from "./prompt-context.js";
import { DatabaseManager } from "./store/db.js";
import { MemoryStore } from "./store/memory-store.js";
import { indexSession } from "./store/session-indexer.js";
import { parseSessionFile } from "./store/session-parser.js";
import { SkillStore } from "./store/skill-store.js";
import { toolDefToAgentTool } from "./tool-def-to-agent-tool.js";
import { registerMemorySearchTool } from "./tools/memory-search-tool.js";
import { createMemoryToolDef } from "./tools/memory-tool.js";
import { registerSessionSearchTool } from "./tools/session-search-tool.js";
import { registerSkillTool } from "./tools/skill-tool.js";
export function resolveProjectSkillDiscovery(
  skillStore: SkillStore,
  projectsMemoryDir: string | undefined,
  cwd?: string,
  projectId?: string,
): { skillPaths: string[] } {
  const detected = detectProjectSkills(projectsMemoryDir, cwd, projectId);
  skillStore.setProjectContext(detected.name, detected.skillsDir);

  const skillPaths = [skillStore.getGlobalSkillsDir()];
  if (detected.skillsDir) skillPaths.push(detected.skillsDir);

  return { skillPaths };
}

export function registerProjectSkillDiscoveryHandler(
  pi: Pick<ExtensionAPI, "on">,
  skillStore: SkillStore,
  projectsMemoryDir: string | undefined,
  projectId?: string,
): void {
  pi.on("resources_discover", async (event, _ctx) => {
    return resolveProjectSkillDiscovery(
      skillStore,
      projectsMemoryDir,
      (event as { cwd?: string }).cwd,
      projectId,
    );
  });
}
export default async function memoryExtension(pi: ExtensionAPI) {
  const config = loadConfig();

  const globalDir = config.memoryDir ?? path.join(getAgentRoot(), "data");
  const store = new MemoryStore({ ...config, memoryDir: globalDir });
  const projectId = getCurrentProjectId();
  const project = detectProject(config.projectsMemoryDir, undefined, projectId);
  const projectName = project.name ?? "";
  const skillStore = new SkillStore({
    globalSkillsDir: path.join(globalDir, "skills"),
    projectSkillsDir: project.memoryDir ? path.join(project.memoryDir, "skills") : undefined,
    projectName: project.name,
  });
  const dbManager = new DatabaseManager(globalDir);

  const refreshSkillProjectContext = (cwd?: string) => {
    const resource = resolveProjectSkillDiscovery(
      skillStore,
      config.projectsMemoryDir,
      cwd,
      projectId,
    );
    return {
      name: skillStore.getProjectName(),
      skillsDir: skillStore.getProjectSkillsDir(),
      resource,
    };
  };

  // Detect project from cwd using shared helper
  const projectStore = project.memoryDir
    ? new MemoryStore({
        ...config,
        memoryCharLimit: config.projectCharLimit,
        memoryDir: project.memoryDir,
      })
    : undefined;

  // Resolve LLM model, API key, and prepare memory tools for in-process prompt runners
  const available = await modelRegistry.getAvailable();
  const defaultModel = available[0];
  if (!defaultModel) {
    throw new Error("No models available for memory extension.");
  }
  const memoryModel = config.llmModelOverride
    ? (modelRegistry.find(defaultModel.provider, config.llmModelOverride) ?? defaultModel)
    : defaultModel;
  const memoryApiKey = (await authStorage.getApiKey(memoryModel.provider)) ?? "";
  if (!memoryApiKey) {
    throw new Error(`No API key for ${memoryModel.provider}. Add one in the model config.`);
  }
  const memoryToolDef = createMemoryToolDef(store, projectStore, dbManager, projectId);
  const memoryTools = [toolDefToAgentTool(memoryToolDef)];

  // ── 1. Load memory from disk on session start ──
  pi.on("session_start", async (_event, ctx) => {
    refreshSkillProjectContext(ctx.cwd);
    await skillStore.ensureDiscoveredRoots();
    await store.loadFromDisk();
    if (projectStore) await projectStore.loadFromDisk();
  });

  registerProjectSkillDiscoveryHandler(pi, skillStore, config.projectsMemoryDir, projectId);

  // ── 2. Inject memory policy + session context into every turn start ──
  // In policy-only mode (default): inject the behavioral policy prompt plus a
  //   <session-context> block with actual memory content.
  // In legacy-inject mode: inject the policy prompt plus frozen memory blocks
  //   (buildPromptContext handles this; buildSessionContext is skipped to avoid
  //   duplicating content that formatForSystemPrompt already injects).
  pi.on("before_agent_start", async (event, _ctx) => {
    const policyBlock = await buildPromptContext(config, store, projectStore, projectName);

    // Session context pre-injection only in policy-only mode (default).
    // In legacy-inject mode the memory blocks are already part of the policy prompt.
    const sessionBlock =
      config.memoryMode === "policy-only"
        ? await buildSessionContext(store, projectStore, projectName, projectId)
        : "";

    const parts: string[] = [];
    if (policyBlock) parts.push(policyBlock);
    if (sessionBlock) parts.push(sessionBlock);

    if (parts.length === 0) return;

    return {
      systemPrompt: event.systemPrompt + "\n\n" + parts.join("\n\n"),
    };
  });

  // ── 3. Register the memory tool (with project store + SQLite sync) ──
  pi.registerTool(memoryToolDef);

  // ── 4. Register the skill tool ──
  registerSkillTool(pi, skillStore);

  // ── 5. Setup background learning loop (with tool-call-aware nudge) ──
  setupBackgroundReview(pi, store, projectStore, config, memoryModel, memoryTools, memoryApiKey);

  // ── 6. Setup session-end flush ──
  setupSessionFlush(pi, store, projectStore, config, memoryModel, memoryTools, memoryApiKey);

  // ── 7. Setup auto-consolidation (inject consolidator into stores) ──
  store.setConsolidator(async (target) => {
    return triggerConsolidation(
      store,
      target,
      memoryModel,
      memoryTools,
      memoryApiKey,
      config.consolidationTimeoutMs,
      target,
    );
  });
  if (projectStore) {
    projectStore.setConsolidator(async (target) => {
      const toolTarget = target === "memory" ? "project" : target;
      return triggerConsolidation(
        projectStore,
        target,
        memoryModel,
        memoryTools,
        memoryApiKey,
        config.consolidationTimeoutMs,
        toolTarget,
      );
    });
  }
  registerConsolidateCommand(
    pi,
    store,
    memoryModel,
    memoryTools,
    memoryApiKey,
    config.consolidationTimeoutMs,
    projectStore,
    projectName,
  );

  // ── 8. Setup correction detection ──
  setupCorrectionDetector(
    pi,
    store,
    projectStore,
    config,
    dbManager,
    memoryModel,
    memoryTools,
    memoryApiKey,
    projectId,
  );

  // ── 9. Register commands ──
  registerInsightsCommand(pi, store, projectStore, projectName);
  registerSkillsCommand(pi, skillStore);
  registerInterviewCommand(pi, store);
  registerSwitchProjectCommand(pi, config);
  registerLearnMemoryCommand(pi);
  registerSyncMarkdownMemoriesCommand(pi, dbManager, globalDir, config.projectsMemoryDir);
  registerPreviewContextCommand(pi, store, projectStore, projectName, config);

  // ── 10. SQLite session search + extended memory ──
  registerSessionSearchTool(pi, dbManager, config.sessionSearch ?? { variant: "legacy" });
  registerMemorySearchTool(pi, dbManager);
  registerIndexSessionsCommand(pi);

  // ── 11. Auto-index session on shutdown ──
  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (sessionFile && require("node:fs").existsSync(sessionFile)) {
        const sessionData = parseSessionFile(sessionFile);
        if (sessionData) {
          indexSession(dbManager, sessionData);
        }
      }
    } catch {
      // Silent fail — don't block shutdown
    }
  });
}
