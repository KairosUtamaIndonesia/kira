import { registerProvider } from "@flue/runtime";
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

import { appRoutes } from "./kira/app-routes";
import { requireRuntimeToken } from "./kira/auth";
import { readAgentProviderApiKey } from "./kira/env";
import {
  KIRA_AGENT_CONTEXT_WINDOW,
  KIRA_AGENT_MAX_OUTPUT_TOKENS,
  KIRA_AGENT_PROVIDER_BASE_URL,
  KIRA_AGENT_PROVIDER_ID,
} from "./kira/model";

const providerApiKey = readAgentProviderApiKey();

registerProvider(KIRA_AGENT_PROVIDER_ID, {
  api: "openai-responses",
  baseUrl: KIRA_AGENT_PROVIDER_BASE_URL,
  contextWindow: KIRA_AGENT_CONTEXT_WINDOW,
  maxTokens: KIRA_AGENT_MAX_OUTPUT_TOKENS,
  models: {
    "gpt-5.5": {
      upstreamModelId: "gh/gpt-5.5",
    },
  },
  ...(providerApiKey !== undefined ? { apiKey: providerApiKey } : {}),
});

const app = new Hono();

app.get("/healthz", (context) =>
  context.json({
    status: "ready",
    packageName: "@kira/agent-runtime",
    runtime: "flue",
  }),
);

app.route("/app", appRoutes);

app.use("/agents/*", requireRuntimeToken);
app.use("/workflows/*", requireRuntimeToken);
app.use("/runs/*", requireRuntimeToken);

app.route("/", flue());

export default app;
