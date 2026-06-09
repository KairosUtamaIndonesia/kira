import { createAgent, defineAgentProfile, type AgentWebSocketHandler } from "@flue/runtime";

import { getDefaultModel } from "../kira/model-catalog";

export const websocket: AgentWebSocketHandler = async (_context, next) => next();

const titleGeneratorAgent = defineAgentProfile({
  instructions: [
    "You are a conversation title generator.",
    "Given a user prompt and assistant response, produce a concise 3-6 word title.",
    "Respond with ONLY the title text. No quotes, no punctuation, no explanation.",
    "Focus on the user's goal or topic, not implementation details.",
  ].join("\n"),
});

export default createAgent(() => ({
  profile: titleGeneratorAgent,
  model: getDefaultModel().upstreamModelId,
}));
