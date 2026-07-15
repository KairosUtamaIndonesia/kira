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
} from "@earendil-works/pi-coding-agent";
import { type WebSocket } from "ws";

import type { ClientCommand, TreeEntry } from "../protocol";

import { createAgentSettings } from "./agent-settings";
import { generateCommitMessage } from "./commit-message-generation";
import { ExtensionUIBridge } from "./extension-ui-bridge";
import guardrailsExtension from "./extensions/guardrails/index";
import memoryExtension from "./extensions/memory/index";
import {
  authStorage,
  modelRegistry,
  getDefaultModel,
  registerProviderExtensions,
} from "./model-registry";
import { extractText, serializeMessages } from "./serialize";
import { attachSession, pushState } from "./session-thread";
import { generateAgentThreadTitle } from "./title-generation";
import { askUserTool } from "./tools/ask-user-tool";

const AGENT_DIR =
  process.env.KIRA_AGENT_DIR ??
  (process.platform === "win32"
    ? `${process.env.APPDATA}/Kira/agent`
    : `${process.env.HOME}/.config/kira/agent`);
const EXTENSIONS = [guardrailsExtension, memoryExtension];

// ── Types ───────────────────────────────────────────────────────────

interface ThreadSession {
  session: CreateAgentSessionResult;
  sessionReady: Promise<void>;
  resolveReady: () => void;
  /** Cleanup function returned by attachSession(). */
  detach: (() => void) | undefined;
}
/** Tree node entry from the session manager's tree. */
interface TreeNodeEntry {
  id: string;
  parentId: string | null;
  type: string;
  timestamp: string;
  message?: { role: string; content?: string };
  summary?: string;
  provider?: string;
  modelId?: string;
}

/** A node in the session manager tree (entries with children). */
interface TreeNode {
  entry: TreeNodeEntry;
  children: TreeNode[];
  label?: string;
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
  private bridge = new ExtensionUIBridge();
  /** Quick lookup: threadId → projectPath, for command routing. */
  private threadToProject = new Map<string, string>();

  // ── Project registration ─────────────────────────────────────────

  async registerProject(input: { projectPath: string; projectId: string }): Promise<void> {
    const pp = input.projectPath;
    const existing = this.projects.get(pp);
    if (existing) {
      existing.refCount++;
      return;
    }

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

  async openThread(
    ws: WebSocket,
    input: {
      threadId: string;
      projectPath: string;
      sessionId: string;
    },
  ): Promise<void> {
    const pp = input.projectPath;
    const project = this.projects.get(pp);
    if (!project) throw new Error(`Project ${pp} not registered`);

    // Skip if already opened
    if (project.threads.has(input.threadId)) return;

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
          settingsManager: createAgentSettings(),
          sessionManager,
          ...(model !== undefined && { model }),
          customTools: [askUserTool],
        });
        // Wire extension UI bridge so ctx.ui.select() works for tools and extensions
        await host.session.bindExtensions({
          uiContext: this.bridge.createContext(ws, input.threadId),
          mode: "rpc",
        });
        const thread: ThreadSession = {
          session: host,
          sessionReady,
          resolveReady,
          detach: undefined,
        };
        project.threads.set(input.threadId, thread);
        resolveReady();
      } catch {
        resolveReady();
      }
    })();

    // Wait for the session to be ready before returning
    await sessionReady;
  }

  async closeThread(threadId: string): Promise<void> {
    this.bridge.rejectAll();
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
    }
  }

  // ── Command routing ──────────────────────────────────────────────

  async handleCommand(ws: WebSocket, cmd: ClientCommand): Promise<void> {
    try {
      switch (cmd.type) {
        // ── Project ──
        case "register_project":
          await this.registerProject({ projectPath: cmd.projectPath, projectId: cmd.projectId });
          break;

        case "open_thread":
          await this.openThread(ws, cmd);
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
            await session.abort();
          });
          break;

        case "set_thinking_level":
          await this.withThread(cmd.threadId, (session) => {
            session.setThinkingLevel(cmd.level);
          });
          break;

        case "compact":
          await this.withThread(cmd.threadId, (session) => {
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

        case "extension_ui_response":
          this.bridge.resolve(cmd.id, cmd);
          break;

        // ── Global ──
        case "refresh_model_catalog":
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
        case "generate_title":
          try {
            const { title } = await generateAgentThreadTitle({
              prompt: cmd.prompt,
              assistantText: cmd.assistantText,
            });
            ws.send(JSON.stringify({ type: "title_generated", requestId: cmd.requestId, title }));
          } catch (e) {
            ws.send(
              JSON.stringify({
                type: "title_generation_failed",
                requestId: cmd.requestId,
                error: (e as Error).message,
              }),
            );
          }
          break;
        case "generate_commit_message":
          {
            const result = await generateCommitMessage({
              stagedDiff: cmd.stagedDiff,
              recentLog: cmd.recentLog,
            });
            if ("commitMessage" in result) {
              ws.send(
                JSON.stringify({
                  type: "commit_message_generated",
                  requestId: cmd.requestId,
                  commitMessage: result.commitMessage,
                }),
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "commit_message_generation_failed",
                  requestId: cmd.requestId,
                  error: result.error,
                }),
              );
            }
          }
          break;
      }
    } catch (e) {
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
  }

  private sendTree(
    ws: WebSocket,
    session: CreateAgentSessionResult["session"],
    threadId: string,
  ): void {
    const sm = session.sessionManager;
    const tree = sm.getTree();
    const leafId = sm.getLeafId();
    const activePath = leafId ? sm.getBranch() : [];
    const activeIds = new Set(activePath.map((e: { id: string }) => e.id));
    const entries: TreeEntry[] = [];

    function walk(nodes: TreeNode[], depth: number) {
      for (const node of nodes) {
        let label: string | undefined = node.label;
        if (label === undefined && sm.getLabel) {
          label = sm.getLabel(node.entry.id);
        }
        entries.push({
          id: node.entry.id,
          // eslint-disable-next-line unicorn/no-null
          parentId: node.entry.parentId ?? null,
          type: node.entry.type,
          depth,
          preview: previewText(node.entry),
          ...(label !== undefined ? { label } : {}),
          isLeaf: node.children.length === 0,
          isActive: activeIds.has(node.entry.id),
          isCurrent: node.entry.id === leafId,
          timestamp: node.entry.timestamp,
        });
        walk(node.children as TreeNode[], depth + 1);
      }
    }
    walk(tree as TreeNode[], 0);
    wrapSend(ws, threadId, { type: "tree_data", entries });
  }
}

// ── Low-level helpers ───────────────────────────────────────────────

function wrapSend(ws: WebSocket, threadId: string, event: Record<string, unknown>): void {
  ws.send(JSON.stringify({ type: "thread_event", threadId, event }));
}

function previewText(entry: TreeNodeEntry): string {
  if (entry.type === "message") {
    const role = entry.message ? entry.message.role : "?";
    const text = entry.message ? extractText(entry.message) : "";
    return `${role}: ${text.slice(0, 120)}`;
  }
  if (entry.type === "compaction") return `compaction: ${(entry.summary ?? "").slice(0, 120)}`;
  if (entry.type === "branch_summary") return `branch: ${(entry.summary ?? "").slice(0, 120)}`;
  if (entry.type === "model_change") return `model: ${entry.provider}/${entry.modelId}`;
  return entry.type;
}
