import { registerProvider } from "@flue/runtime";
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

import { appRoutes } from "./kira/app-routes";
import { requireRuntimeToken } from "./kira/auth";
import {
  KIRA_AGENT_PROVIDER_BASE_URL,
  KIRA_AGENT_PROVIDER_ID,
  readAgentProviderApiKey,
} from "./kira/env";

const GPT_55_CONTEXT_WINDOW = 272_000;
const GPT_55_MAX_TOKENS = 128_000;
const providerApiKey = readAgentProviderApiKey();

registerProvider(KIRA_AGENT_PROVIDER_ID, {
  api: "openai-responses",
  baseUrl: KIRA_AGENT_PROVIDER_BASE_URL,
  contextWindow: GPT_55_CONTEXT_WINDOW,
  maxTokens: GPT_55_MAX_TOKENS,
  models: {
    "gpt-5.5": {
      contextWindow: GPT_55_CONTEXT_WINDOW,
      maxTokens: GPT_55_MAX_TOKENS,
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
