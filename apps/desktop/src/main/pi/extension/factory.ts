/**
 * Foundry's extension, as pi sees it.
 *
 * Foundry hands pi's session bootstrap the options a resource loader is built
 * from, carrying this factory, and pi calls the factory while it builds the
 * session. Every hook below is therefore ordinary typed TypeScript in this repo —
 * checked by `typecheck` and reachable by the same tests as the rest of the agent
 * harness — rather than a package discovered from a config directory at runtime
 * and loaded through jiti.
 *
 * This module is the only one that knows pi's `ExtensionAPI`. What it is handed
 * is read into turns by `entries.ts`, worked out into a ledger by `memory.ts`,
 * selected by `projection.ts`, written down by `compact.ts`, drawn from by
 * `reflector.ts` and looked up by `recall.ts` — none of which knows the extension
 * exists, so that an upgrade of pi has these places to break and cannot reach the
 * logic itself.
 */
import type {
  AgentToolResult,
  ExtensionAPI,
  SessionBeforeCompactEvent,
} from '@earendil-works/pi-coding-agent';
import { getShellConfig, isToolCallEventType } from '@earendil-works/pi-coding-agent';
import type { ChatMode } from '../../../preload/bridge.ts';
import type { TSchema } from 'typebox';
import { reflectingWith } from '../../../preload/bridge.ts';
import { memoryRuns, type MemorySource } from '../../memory.ts';
import type { StoredReflection, ThreadStore } from '../../db/threads.ts';
import type { Models } from '../models.ts';
import type { Tracker } from '../../tracker.ts';
import type { McpManager, McpToolBinding } from '../../mcp/servers.ts';
import type { Questionnaires } from '../../questionnaires.ts';
import { lastWords, reconstruct, type CompactionDetails } from './compact.ts';
import { numberedIn, turnsOf, turnsStoredIn } from './entries.ts';
import { observationsIn, observationsOf, type Observation } from './memory.ts';
import { recallTool } from './recallTool.ts';
import { questionnaireTool } from './questionnaireTool.ts';
import { browserTools } from './browserTools.ts';
import { askForConclusions, reflectionPrompt } from './reflector.ts';
import {
  breakdownProposalTool,
  decisionProposalTool,
  mapProposalTool,
  outcomeProposalTool,
  specProposalTool,
  trackerTools,
} from './trackerTool.ts';
import { toolAllowedInMode, toolsForMode, workflowForMode } from '../workflow.ts';

/**
 * Foundry's extension: the hooks pi calls, and nothing else.
 *
 * The shape is named rather than left as pi's `InlineExtension`, which is a union
 * that also covers a bare factory function: what Foundry hands over is always the
 * named form, so saying so is what lets a test call the factory the way pi does.
 */
export function foundryExtension({
  cwd,
  store,
  threadId,
  workspaceId = null,
  models,
  memorySettings,
  tracker,
  mcp,
  questionnaires,
  getShellPath = () => undefined,
  registerCleanup,
}: {
  cwd: string;
  store: ThreadStore;
  threadId: string;
  workspaceId?: string | null;
  models: Models;
  /**
   * What this person decided about memory, read at each compaction rather than
   * once at boot — so switching memory off, or choosing another reflecting model,
   * reaches the chats already open.
   */
  memorySettings?: MemorySource;
  /** The main-process tracker capability shared by every chat. */
  tracker?: Tracker;
  /** The app-level MCP manager, shared by every Pi session. */
  mcp?: McpManager;
  /** The main-process broker for interactive user questions. */
  questionnaires?: Questionnaires;
  /** Current executable selected for Pi's Bash tool. */
  getShellPath?: () => string | undefined;
  registerCleanup?: (cleanup: () => void) => void;
}): { name: string; factory: (pi: ExtensionAPI) => void } {
  return {
    name: 'foundry',
    factory: (pi: ExtensionAPI) => {
      const registeredMcpTools = new Set<string>();
      const mode = (): ChatMode => store.getThread(threadId).mode;
      const currentMcpTools = (): string[] =>
        mcp?.tools(workspaceId).map((tool) => tool.name) ?? [];
      let appliedMode: ChatMode | undefined = 'build';
      const applyModeTools = (): void => {
        const current = mode();
        // Pi enables every registered extension tool in the Build baseline and
        // MCP synchronization maintains its active tools. Avoid rebuilding that
        // registry until the mode actually changes.
        if (current === appliedMode) return;
        const available = pi.getAllTools().map((tool) => tool.name);
        pi.setActiveTools(
          toolsForMode(current, available, currentMcpTools(), [...registeredMcpTools]),
        );
        appliedMode = current;
      };

      pi.on('before_agent_start', (event) => {
        const current = mode();
        applyModeTools();
        return { systemPrompt: `${event.systemPrompt}\n\n${workflowForMode(current)}` };
      });
      // Tool-list filtering is what Kira sees. This guard is the trust boundary:
      // a model can still attempt a tool it was not offered, so Spec mode refuses
      // every action outside its explicit read/planning allowlist.
      pi.on('tool_call', (event) => {
        if (isToolCallEventType('bash', event)) {
          const shell = getShellConfig(getShellPath()).shell;
          const quotedShell = `'${shell.replace(/'/g, "'\\''")}'`;
          event.input.command = `export SHELL=${quotedShell}\n${event.input.command}`;
        }
        if (toolAllowedInMode(mode(), event.toolName, [...registeredMcpTools])) return undefined;
        return {
          block: true,
          reason: 'Spec mode is planning-only. Switch to Build mode before using this tool.',
        };
      });

      for (const tool of browserTools(threadId, async (chatId, operation) =>
        (await import('../../browser/controller.ts')).browserForWindow().operate(chatId, operation),
      )) {
        pi.registerTool(tool);
      }
      pi.on('session_before_compact', async (event) => {
        // Memory off does not stop a compaction, and must not: the summary is
        // recomputed from the conversation rather than remembered, so a chat that
        // keeps nothing still compacts deterministically, still shows its boundary
        // and still has `recall`. What it stops is this chat's own ledger, what the
        // rest of its workspace decided, and the model call that draws conclusions
        // from them — which is the whole of what a person is turning off.
        if (!memoryRuns(memorySettings)) {
          return compacted(event, cwd, [], []);
        }

        const elsewhere = decidedInProject(store, threadId);
        const reflections = await concludedBy(
          models,
          cwd,
          store,
          threadId,
          event.branchEntries,
          event.signal,
          reflectingWith(memorySettings?.() ?? null),
        );

        return compacted(event, cwd, elsewhere, reflections);
      });
      pi.registerTool(recallTool(store, threadId));
      pi.registerTool(specProposalTool());
      pi.registerTool(mapProposalTool());
      pi.registerTool(decisionProposalTool());
      pi.registerTool(outcomeProposalTool());
      pi.registerTool(breakdownProposalTool());
      if (questionnaires !== undefined) {
        pi.registerTool(questionnaireTool(questionnaires, threadId));
      }
      if (tracker !== undefined) {
        for (const tool of trackerTools(store, threadId, tracker)) pi.registerTool(tool);
      }
      if (mcp !== undefined) {
        const registered = new Map<string, string>();
        let bound = false;

        const syncMcpTools = (): void => {
          const tools = mcp.tools(workspaceId);
          for (const tool of tools) {
            const signature = JSON.stringify([tool.description, tool.inputSchema]);
            if (registered.get(tool.name) === signature) continue;
            pi.registerTool(mcpTool(tool, mcp, workspaceId));
            registered.set(tool.name, signature);
            registeredMcpTools.add(tool.name);
          }
          if (!bound) return;

          // Pi 0.85.1 has no unregister operation. Keep old definitions safe but
          // remove them from the model's active list when the manager disconnects.
          const active = pi.getActiveTools().filter((name) => !registered.has(name));
          pi.setActiveTools([...new Set([...active, ...tools.map((tool) => tool.name)])]);
          if (mode() === 'spec') {
            appliedMode = undefined;
            applyModeTools();
          }
        };

        syncMcpTools();
        bound = true;
        const unsubscribe = mcp.subscribe(syncMcpTools);
        // AgentSession.dispose() invalidates the extension without emitting session_shutdown.
        registerCleanup?.(unsubscribe);
        pi.on('session_shutdown', () => unsubscribe());
      }
    },
  };
}

function mcpTool(tool: McpToolBinding, mcp: McpManager, workspaceId: string | null) {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as TSchema,
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const result = await mcp.callTool(tool.name, params, signal, workspaceId);
        if (result.isError) {
          throw new Error(
            resultContent(result.content, result.structuredContent)
              .map((part) => (part.type === 'text' ? part.text : '[image]'))
              .join(' '),
          );
        }
        return {
          content: resultContent(result.content, result.structuredContent),
          details: undefined,
        };
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    },
  };
}

function resultContent(
  content: readonly unknown[],
  structured: unknown,
): AgentToolResult<undefined>['content'] {
  const result: AgentToolResult<undefined>['content'] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null || !('type' in block)) continue;
    const typed = block as { type: unknown; text?: unknown; data?: unknown; mimeType?: unknown };
    if (typed.type === 'text' && typeof typed.text === 'string') {
      result.push({ type: 'text', text: typed.text });
    } else if (
      typed.type === 'image' &&
      typeof typed.data === 'string' &&
      typeof typed.mimeType === 'string'
    ) {
      result.push({ type: 'image', data: typed.data, mimeType: typed.mimeType });
    } else {
      result.push({ type: 'text', text: JSON.stringify(block) });
    }
  }

  if (!result.some((part) => part.type === 'text') && structured !== undefined) {
    result.push({ type: 'text', text: JSON.stringify(structured) });
  }
  return result;
}

/**
 * Draw what this chat has worked out, and hand back everything it now holds.
 *
 * The one model call Foundry makes on its own behalf, so it happens once per
 * compaction and only when there is something to conclude from: a chat that has
 * noticed nothing has nothing to draw, and asking anyway would spend a person's
 * allowance to be told so.
 *
 * Guarded, like the workspace read and for the same reason — a throw inside this
 * hook is caught by pi, which then reports an extension error and writes the
 * summary itself with a model instead, charging for a summary nobody asked it
 * for. Everything the reflector touches is inside the guard, including the reads
 * it finishes with: what a chat concluded is worth much less than the chat still
 * being able to compact.
 *
 * A pool that refuses a call is not what the guard is for. pi turns a refused
 * completion into a reply with nothing in it rather than a rejection, so a refused
 * reflection is an empty list — which is the right answer and costs the
 * conclusions, not the compaction. What the guard is for is everything else: a
 * database that cannot be read, a provider that cannot be reached at all, a
 * transport failure that throws on its own.
 */
async function concludedBy(
  models: Models,
  cwd: string,
  store: ThreadStore,
  threadId: string,
  branchEntries: SessionBeforeCompactEvent['branchEntries'],
  signal: AbortSignal,
  reflectingModel: string | null,
): Promise<StoredReflection[]> {
  try {
    const branch = turnsStoredIn(branchEntries);
    const numbered = numberedIn(branch);
    const held = observationsIn(branch, cwd);

    // A chat that has noticed nothing has nothing to draw conclusions from, and
    // asking a model anyway would spend a person's allowance to be told so.
    if (held.length > 0) {
      const answered = await askForConclusions(
        {
          models,
          cwd,
          // The model this person chose to reflect with, which is not the one the
          // chat runs on unless they made it so; a chat that has no model of its
          // own falls back to the one it is running on, as it did before there was
          // a choice to make.
          modelId: reflectingModel ?? store.getThread(threadId).modelId,
          signal,
        },
        reflectionPrompt(
          held,
          new Map(numbered.map((each) => [each.entryId, each.number])),
          store.loadReflections(threadId),
        ),
      );

      // Drawn up to the end of the chat as it now stands: a conclusion accounts
      // for everything the reflector was shown, which is the whole branch.
      const coversThrough = numbered[numbered.length - 1]?.number ?? null;

      store.recordReflections(
        threadId,
        answered.map((text) => ({ text, coversThrough })),
      );
    }

    // Read back rather than assembled here, because what the chat holds is the
    // store's answer: a conclusion offered twice is held once, and which of these
    // are new is decided by the table rather than by this function.
    return store.loadReflections(threadId);
  } catch (error) {
    console.error('[foundry] what this chat worked out was not drawn:', error);

    return [];
  }
}

/**
 * What the other chats of this chat's workspace decided.
 *
 * Read when the compaction happens rather than when the session booted, so that
 * the answer is what the rest of the workspace is holding now rather than what it
 * was holding when this chat was opened. A chat filed nowhere decided nothing
 * with anyone and gets nothing.
 *
 * Bounded and guarded. Bounded because these are other people's turns — in
 * another chat of the same work, but still another chat — and guarded because a
 * ledger that cannot be read is a summary without the workspace's side of it,
 * which is much better than a compaction that does not happen at all.
 */
function decidedInProject(store: ThreadStore, threadId: string): Observation[] {
  try {
    const workspaceId = store.findThread(threadId)?.workspaceId;
    if (workspaceId === undefined || workspaceId === null) return [];

    return observationsOf(store.loadWorkspaceObservations(workspaceId, threadId));
  } catch (error) {
    console.error('[foundry] what the rest of the workspace decided was not read:', error);

    return [];
  }
}

/**
 * Answer a compaction with a summary reconstructed from the chat.
 *
 * pi has already chosen where the boundary falls and says so in
 * `firstKeptEntryId`, so nothing here reimplements its cut point, its token
 * budgets or its turn splitting: what it prepared is consumed and answered. That
 * is also why one hook serves a manual compaction, a threshold one and an
 * overflow recovery alike — `reason` says which it was, and the answer does not
 * depend on which.
 *
 * The turns are read from two places, and which is which is the shape of the
 * whole reconstruction. The goal, the files, the commits and what the person
 * asked for come from `branchEntries` — everything the chat ever said — so that
 * they are recomputed from the conversation itself and a chat's fifth compaction
 * knows exactly as much as its first. Only the transcript comes from the window
 * being discarded, because a transcript is what the discarded turns *are*.
 *
 * `elsewhere` is the third source and the only one that is not this chat: what
 * the workspace's other chats decided, read from the database by the caller because
 * a compaction has no way to see them and no business pretending they are turns
 * of this conversation. `reflections` is the fourth, and the only one that did not
 * come from the turns at all: what a model worked out from this chat's ledger
 * before the summary was built, handed here rather than read, so that this stays a
 * function of what it is given.
 *
 * A boundary may fall inside a turn, and pi would then summarize the start of
 * that turn separately and paste the two together; a reconstruction that reads
 * the turns themselves has no reason to split them again, and taking both lists
 * in the order they were said puts the start of that turn back in front of the
 * rest of it.
 *
 * Where the cut fell is returned beside the summary rather than written into it.
 * The window needs it to say *which* part of the chat was discarded, and reading
 * it back out of the summary's own prose would mean parsing what this module just
 * wrote. pi keeps `details` on the entry and never puts it in front of the model.
 */
function compacted(
  event: SessionBeforeCompactEvent,
  cwd: string,
  elsewhere: readonly Observation[],
  reflections: readonly StoredReflection[],
) {
  const { preparation } = event;

  const branch = turnsStoredIn(event.branchEntries);
  const discarded = turnsOf([
    ...preparation.messagesToSummarize,
    ...preparation.turnPrefixMessages,
  ]);
  const details: CompactionDetails = { lastWords: lastWords(discarded) };

  return {
    compaction: {
      summary: reconstruct({ branch, discarded, cwd, elsewhere, reflections }),
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details,
    },
  };
}
