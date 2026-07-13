/**
 * SessionHost — manages AgentSessions per thread with shared project infrastructure.
 *
 * Project registration happens once per project path. Threads within a project
 * share the resource loader, model registry, and settings manager.
 * All commands arrive over a single global WebSocket.
 */

import {
  createAgentSession,
  type CreateAgentSessionResult,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { type WebSocket } from "ws";

import type { ClientCommand, TreeEntry } from "../protocol";

import { logger } from "./log";
import {
  authStorage,
  modelRegistry,
  getDefaultModel,
  registerProviderExtensions,
} from "./model-registry";
import { extractText, serializeMessages, type MessageInput } from "./serialize";
import { attachSession, pushState } from "./session-thread";
import { askUserTool } from "./tools/ask-user-tool";

const AGENT_DIR =
  process.env.KIRA_AGENT_DIR ??
  (process.platform === "win32"
    ? `${process.env.APPDATA}/Kira/agent`
    : `${process.env.HOME}/.config/kira/agent`);
const EXTENSIONS: [] = [];

// ── Types ───────────────────────────────────────────────────────────

interface ThreadSession {
  session: CreateAgentSessionResult;
  sessionReady: Promise<void>;
  resolveReady: () => void;
  /** Cleanup function returned by attachSession(). */
  detach: (() => void) | undefined;
}

interface ProjectState {
  resourceLoader: DefaultResourceLoader;
  /** Sessions keyed by threadId */
  threads: Map<string, ThreadSession>;
  refCount: number;
}

// ── SessionHost ──────────────────────────────────────────────────────

export class SessionHost {
  private projects = new Map<string, ProjectState>();
  /** Quick lookup: threadId → projectPath, for command routing. */
  private threadToProject = new Map<string, string>();

  // ── Project registration ─────────────────────────────────────────

  async registerProject(input: { projectPath: string; projectId: string }): Promise<void> {
    const pp = input.projectPath;
    if (this.projects.has(pp)) {
      const existing = this.projects.get(pp);
      if (existing) existing.refCount++;
      return;
    }

    logger.error(`[session-host] initializing project services for ${pp}...`);

    const loader = new DefaultResourceLoader({
      cwd: pp,
      agentDir: AGENT_DIR,
      extensionFactories: EXTENSIONS,
    });
    await loader.reload();

    this.projects.set(pp, {
      resourceLoader: loader,
      threads: new Map(),
      refCount: 1,
    });
  }

  // ── Thread management ────────────────────────────────────────────

  async openThread(input: {
    threadId: string;
    projectPath: string;
    sessionId: string;
  }): Promise<void> {
    const pp = input.projectPath;
    const project = this.projects.get(pp);
    if (!project) throw new Error(`Project ${pp} not registered`);

    // Skip if already opened
    if (project.threads.has(input.threadId)) return;

    logger.error(`[session-host] building session for thread ${input.threadId}...`);

    let resolveReady!: () => void;
    const sessionReady = new Promise<void>((r) => {
      resolveReady = r;
    });

    const sessionDir = `${AGENT_DIR}/sessions/${input.threadId}`;
    const sessionManager = SessionManager.open(`${sessionDir}/session.jsonl`, sessionDir, pp);

    const defaultModel = getDefaultModel();
    const model = defaultModel
      ? modelRegistry.find(defaultModel.provider, defaultModel.id)
      : undefined;

    (async () => {
      try {
        const host = await createAgentSession({
          cwd: pp,
          agentDir: AGENT_DIR,
          authStorage,
          modelRegistry,
          resourceLoader: project.resourceLoader,
          settingsManager: SettingsManager.inMemory(),
          sessionManager,
          ...(model !== undefined && { model }),
          customTools: [askUserTool],
        });
        const thread: ThreadSession = {
          session: host,
          sessionReady,
          resolveReady,
          detach: undefined,
        };
        project.threads.set(input.threadId, thread);
        resolveReady();
        const m = host.session.model;
        logger.error(
          `[session-host] session ready for thread ${input.threadId} (model: ${m ? m.id : "none"})`,
        );
      } catch (err) {
        logger.error(`[session-host] session build failed for thread ${input.threadId}:`, err);
        resolveReady();
      }
    })();

    // Wait for the session to be ready before returning
    await sessionReady;
  }

  async closeThread(threadId: string): Promise<void> {
    const projectPath = this.threadToProject.get(threadId);
    if (!projectPath) return;
    this.threadToProject.delete(threadId);

    const project = this.projects.get(projectPath);
    if (!project) return;
    const thread = project.threads.get(threadId);
    if (thread && thread.detach) {
      thread.detach();
    }
    project.threads.delete(threadId);

    project.refCount--;
    if (project.refCount <= 0) {
      this.projects.delete(projectPath);
      logger.error(`[session-host] disposed project services for ${projectPath}`);
    }
  }

  // ── Command routing ──────────────────────────────────────────────

  async handleCommand(ws: WebSocket, cmd: ClientCommand): Promise<void> {
    try {
      switch (cmd.type) {
        // ── Project ──
        case "register_project":
          const ppShort = cmd.projectPath ? cmd.projectPath.slice(0, 40) : "";
          logger.error(`[session-host] register_project: ${ppShort}`);
          await this.registerProject(cmd);
          break;

        // ── Thread management ──
        case "open_thread":
          await this.openThread(cmd);
          this.threadToProject.set(cmd.threadId, cmd.projectPath);
          await this.sendSessionSnapshot(ws, cmd.threadId);
          // Wire event forwarding so streaming events reach the WS
          this.attachEvents(ws, cmd.threadId);
          break;

        case "close_thread":
          await this.closeThread(cmd.threadId);
          break;

        // ── Thread actions ──
        case "prompt":
          // Fire-and-forget: the turn can run for minutes; commands are
          // serialized per connection, so awaiting here would block abort.
          await this.withThread(cmd.threadId, (session) => {
            logger.error(
              `[${cmd.threadId.slice(0, 8)}] prompt: "${cmd.message.slice(0, 80).replace(/\n/g, "\\n")}"`,
            );
            void (async () => {
              try {
                await session.prompt(
                  cmd.message,
                  cmd.streamingBehavior !== undefined
                    ? { streamingBehavior: cmd.streamingBehavior }
                    : {},
                );
              } catch (e) {
                wrapSend(ws, cmd.threadId, { type: "error", message: (e as Error).message });
              } finally {
                pushState(session, ws, cmd.threadId);
              }
            })();
          });
          break;

        case "abort":
          await this.withThread(cmd.threadId, async (session) => {
            logger.error(`[${cmd.threadId.slice(0, 8)}] abort`);
            await session.abort();
          });
          break;

        case "set_thinking_level":
          await this.withThread(cmd.threadId, (session) => {
            logger.error(`[${cmd.threadId.slice(0, 8)}] thinking: ${cmd.level}`);
            session.setThinkingLevel(cmd.level);
          });
          break;

        case "compact":
          await this.withThread(cmd.threadId, (session) => {
            logger.error(`[${cmd.threadId.slice(0, 8)}] compact`);
            void (async () => {
              try {
                await session.compact(cmd.customInstructions);
              } catch (e) {
                wrapSend(ws, cmd.threadId, { type: "error", message: (e as Error).message });
              }
            })();
          });
          break;

        case "get_tree":
          await this.withThread(cmd.threadId, async (session) => {
            this.sendTree(ws, session, cmd.threadId);
          });
          break;

        case "navigate_tree":
          await this.withThread(cmd.threadId, async (session) => {
            logger.error(`[${cmd.threadId.slice(0, 8)}] navigate_tree: ${cmd.entryId.slice(0, 8)}`);
            const result = await session.navigateTree(cmd.entryId, {
              summarize: cmd.summarize ?? false,
            });
            wrapSend(ws, cmd.threadId, {
              type: "tree_navigated",
              cancelled: result.cancelled,
            });
            if (!result.cancelled) {
              const messages = serializeMessages(session);
              wrapSend(ws, cmd.threadId, { type: "messages", messages });
            }
            pushState(session, ws, cmd.threadId);
          });
          break;

        case "tool_ui_response":
          // Not yet wired — extension UI adapter handles this via ctx.ui
          break;

        // ── Global ──
        case "refresh_model_catalog":
          logger.error(`[session-host] refresh_model_catalog`);
          try {
            await registerProviderExtensions();
            ws.send(JSON.stringify({ type: "model_catalog_refreshed", success: true }));
          } catch (e) {
            ws.send(
              JSON.stringify({
                type: "model_catalog_refreshed",
                success: false,
                error: (e as Error).message,
              }),
            );
          }
          break;
      }
    } catch (e) {
      logger.error(`[session-host] command error:`, e);
      ws.send(JSON.stringify({ type: "error", message: (e as Error).message }));
    }
  }

  // ── Event forwarding ────────────────────────────────────────────

  /**
   * Subscribe to a thread's session events and forward them over the WS.
   * Re-attaches when a new connection reopens the thread (the old WS is dead).
   */
  private attachEvents(ws: WebSocket, threadId: string): void {
    const projectPath = this.threadToProject.get(threadId);
    if (!projectPath) return;
    const project = this.projects.get(projectPath);
    if (!project) return;
    const thread = project.threads.get(threadId);
    if (!thread) return;

    // Detach from the previous connection before wiring the new one
    if (thread.detach) thread.detach();
    thread.detach = attachSession(ws, thread.session.session, threadId);
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private async withThread(
    threadId: string,
    fn: (session: CreateAgentSessionResult["session"]) => Promise<void> | void,
  ): Promise<void> {
    const projectPath = this.threadToProject.get(threadId);
    if (!projectPath) throw new Error(`Thread ${threadId} not found`);
    const project = this.projects.get(projectPath);
    if (!project) throw new Error(`Project for thread ${threadId} not found`);
    const thread = project.threads.get(threadId);
    if (!thread) throw new Error(`Thread ${threadId} session not ready`);
    await thread.sessionReady;
    await fn(thread.session.session);
  }

  private async sendSessionSnapshot(ws: WebSocket, threadId: string): Promise<void> {
    const projectPath = this.threadToProject.get(threadId);
    if (!projectPath) return;
    const project = this.projects.get(projectPath);
    if (!project) return;
    const thread = project.threads.get(threadId);
    if (!thread) return;

    const session = thread.session.session;
    wrapSend(ws, threadId, {
      type: "messages",
      messages: serializeMessages(session),
    });
    this.sendTree(ws, session, threadId);
    pushState(session, ws, threadId);
    logger.error(`[session-host] initial state pushed to thread ${threadId}`);
  }

  private sendTree(
    ws: WebSocket,
    session: { sessionManager: SessionManager },
    threadId: string,
  ): void {
    const sm = session.sessionManager;
    const tree = sm.getTree();
    const leafId = sm.getLeafId();
    const activePath = leafId ? sm.getBranch() : [];
    const activeIds = new Set(activePath.map((e: { id: string }) => e.id));
    const entries: TreeEntry[] = [];

    function walk(
      nodes: {
        entry: { id: string; parentId: string | null; type: string; timestamp: string };
        children: typeof nodes;
        label?: string;
      }[],
      depth: number,
    ) {
      for (const node of nodes) {
        const label = node.label ?? (sm.getLabel ? sm.getLabel(node.entry.id) : undefined);
        entries.push({
          id: node.entry.id,
          parentId: node.entry.parentId,
          type: node.entry.type,
          depth,
          preview: previewText(node.entry),
          ...(label !== undefined && { label }),
          isLeaf: node.children.length === 0,
          isActive: activeIds.has(node.entry.id),
          isCurrent: node.entry.id === leafId,
          timestamp: node.entry.timestamp,
        });
        walk(node.children, depth + 1);
      }
    }
    walk(tree, 0);
    wrapSend(ws, threadId, { type: "tree_data", entries });
  }
}

// ── Low-level helpers ───────────────────────────────────────────────

function wrapSend(ws: WebSocket, threadId: string, event: Record<string, unknown>): void {
  ws.send(JSON.stringify({ type: "thread_event", threadId, event }));
}

function previewText(entry: {
  type: string;
  message?: { role?: string };
  summary?: string;
  provider?: string;
  modelId?: string;
}): string {
  if (entry.type === "message") {
    const msg = entry.message;
    const role = msg && msg.role ? msg.role : "?";
    const text = extractText(msg as MessageInput);
    return `${role}: ${text.slice(0, 120)}`;
  }
  if (entry.type === "compaction") return `compaction: ${(entry.summary ?? "").slice(0, 120)}`;
  if (entry.type === "branch_summary") return `branch: ${(entry.summary ?? "").slice(0, 120)}`;
  if (entry.type === "model_change") return `model: ${entry.provider}/${entry.modelId}`;
  return entry.type;
}
