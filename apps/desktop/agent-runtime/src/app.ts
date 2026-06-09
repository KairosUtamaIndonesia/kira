import { registerProvider } from "@flue/runtime";
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

import { appRoutes } from "./kira/app-routes";
import { requireRuntimeToken } from "./kira/auth";
import { readAgentProviderApiKey } from "./kira/env";
import { modelCatalog } from "./kira/model-catalog";

const providerApiKey = readAgentProviderApiKey();

type ProviderRegistration = {
  providerId: string;
  baseUrl: string;
  contextWindow: number;
  maxTokens: number;
  models: Record<string, { upstreamModelId: string }>;
};

const providers = new Map<string, ProviderRegistration>();

for (const model of modelCatalog.models) {
  const key = `${model.providerId}\n${model.providerBaseUrl}`;
  const existing = providers.get(key);

  if (existing === undefined) {
    providers.set(key, {
      providerId: model.providerId,
      baseUrl: model.providerBaseUrl,
      contextWindow: model.contextWindow,
      maxTokens: model.maxOutputTokens,
      models: { [model.label]: { upstreamModelId: model.upstreamModelId } },
    });
    continue;
  }

  existing.contextWindow = Math.max(existing.contextWindow, model.contextWindow);
  existing.maxTokens = Math.max(existing.maxTokens, model.maxOutputTokens);
  existing.models[model.label] = { upstreamModelId: model.upstreamModelId };
}

for (const provider of providers.values()) {
  registerProvider(provider.providerId, {
    api: "openai-responses",
    baseUrl: provider.baseUrl,
    contextWindow: provider.contextWindow,
    maxTokens: provider.maxTokens,
    models: provider.models,
    ...(providerApiKey !== undefined ? { apiKey: providerApiKey } : {}),
  });
}

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
