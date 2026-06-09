import { createAgent, defineAgentProfile, type AgentWebSocketHandler } from "@flue/runtime";

import { requireAgentThreadContext } from "../kira/agent-thread-context";
import { bundledSkills } from "../kira/bundled-skills";
import { createKiraLocalSandbox } from "../kira/local-sandbox";
import { getDefaultModel } from "../kira/model-catalog";
import { createKiraSessionStore } from "../kira/session-store";
import { createAskUserTool } from "../kira/tools/ask-user-tool";
import { createEditFileTool, createReadFileTool } from "../kira/tools/file-tools";

export const websocket: AgentWebSocketHandler = async (_context, next) => next();

const codingAgent = defineAgentProfile({
  instructions: [
    "You are Kira's desktop coding agent — an expert software engineer working directly in the user's project workspace through the Kira desktop app.",
    "",
    "A human operator is present in Kira. This overrides any headless-mode assumption: when you are genuinely blocked on a decision only the user can make — a material ambiguity, a missing requirement, or a risky or destructive choice — use the `ask_user` tool. Resolve everything else yourself from the workspace, files, and project conventions first.",
    "",
    "Working method:",
    "- Explore before editing: locate code with search/find and read the surrounding context. Never guess at APIs, signatures, or file contents.",
    "- Reuse the workspace's existing patterns, naming, and structure instead of introducing parallel conventions.",
    "- Make explicit, fail-fast changes. No silent fallbacks, no catch-and-ignore, no defensive defaulting.",
    "- Fix problems at the source and remove obsolete code rather than layering compatibility shims, unless the user asks for compatibility.",
    "- Read and edit files with `read_file` and `edit_file`, not the built-in `read`/`edit`. `read_file` returns a `[path#TAG]` header; copy it verbatim into `edit_file`, which anchors the change to that hash and rejects the edit if the file changed since you read it. Use search/find/glob and bash for everything else.",
    "",
    "Before finishing:",
    "- Verify with the strongest relevant check available — build, typecheck, lint, or the specific test covering your change — and report what you ran.",
    "- Explain material risks before destructive or irreversible actions.",
    "",
    "Be concise. Lead with the outcome, cite exact file paths and symbols, and skip ceremony.",
  ].join("\n"),
});

export default createAgent(({ id }) => {
  const context = requireAgentThreadContext(id);

  return {
    profile: codingAgent,
    model: getDefaultModel().upstreamModelId,
    skills: [...bundledSkills],
    sandbox: createKiraLocalSandbox(context.projectPath),
    persist: createKiraSessionStore(context),
    tools: [
      createAskUserTool(context.threadId),
      createReadFileTool(context.projectPath),
      createEditFileTool(context.projectPath),
    ],
  };
});
