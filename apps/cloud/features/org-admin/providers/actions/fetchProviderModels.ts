import { createServerFn } from "@tanstack/react-start";

import { requireOrgPermission, requireOrganization } from "@/lib/auth/guards";

type ProviderModel = {
  id: string;
  name: string;
  context_length: number | undefined;
  max_output_tokens: number | undefined;
  capabilities:
    | {
        reasoning?: boolean;
        thinking?: boolean;
        tool_calling?: boolean;
        vision?: boolean;
      }
    | undefined;
};

type FetchProviderModelsInput = {
  organizationId: string;
  providerBaseUrl: string;
  apiKey?: string;
  modelsEndpoint?: string;
};

type FetchProviderModelsResult =
  | { status: "success"; models: ProviderModel[] }
  | { status: "error"; message: string; models: [] };
function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

const fetchProviderModelsAction = createServerFn({ method: "GET" })
  .validator((input: FetchProviderModelsInput) => input)
  .handler(async ({ data: input }): Promise<FetchProviderModelsResult> => {
    try {
      await requireOrgPermission(input.organizationId, { model: ["read"] });
      await requireOrganization(input.organizationId);

      const baseUrl = input.providerBaseUrl.replace(/\/$/, "");
      const endpoint =
        (input.modelsEndpoint !== undefined ? input.modelsEndpoint.replace(/^\//, "") : "") ||
        "models";
      const url = `${baseUrl}/${endpoint}`;

      const headers: Record<string, string> = { accept: "application/json" };
      if (input.apiKey !== undefined && input.apiKey.length > 0) {
        headers.authorization = `Bearer ${input.apiKey}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        return {
          status: "error",
          message: `Provider returned ${response.status} ${response.statusText}`,
          models: [],
        };
      }

      const body: unknown = await response.json();
      if (
        body === null ||
        typeof body !== "object" ||
        !("data" in body) ||
        !Array.isArray(body.data)
      ) {
        return {
          status: "error",
          message: "Provider returned an unexpected response format. Expected { data: [...] }.",
          models: [],
        };
      }

      // Two-pass filter: first pass collects IDs of non-chat models (video, image, embedding),
      // second pass excludes all entries with those IDs. Some providers return models like
      // "veo-free/veo" twice (once without type, once with type:"video"). A simple
      // "skip if type !== undefined && type !== 'chat'" filter would let the typeless
      // variant leak through after deduplication.
      const videoModelIds = new Set<string>();
      const allEntries: Array<Record<string, unknown>> = [];
      for (const entry of body.data) {
        if (entry === null || typeof entry !== "object") continue;
        const model = entry as Record<string, unknown>;
        const modelId = typeof model.id === "string" ? model.id : undefined;
        if (modelId === undefined) continue;

        allEntries.push(model);

        const modelType = typeof model.type === "string" ? model.type : undefined;
        if (modelType !== undefined && modelType !== "chat") {
          videoModelIds.add(modelId);
        }
      }

      // Second pass: exclude if ANY entry for that ID had a non-chat type
      const rawModels: Array<Record<string, unknown>> = [];
      for (const model of allEntries) {
        const rawId = model.id as string;
        if (videoModelIds.has(rawId)) continue;
        rawModels.push(model);
      }

      // Dedup by id after filtering (first seen wins)
      const seen = new Set<string>();
      const models: ProviderModel[] = [];
      for (const model of rawModels) {
        const rawId = model.id as string;
        if (seen.has(rawId)) continue;
        seen.add(rawId);

        const rawCaps =
          model.capabilities !== null && typeof model.capabilities === "object"
            ? (model.capabilities as Record<string, unknown>)
            : undefined;

        models.push({
          id: rawId,
          name: typeof model.name === "string" ? model.name : rawId,
          context_length: parseOptionalNumber(model.context_length),
          max_output_tokens: parseOptionalNumber(model.max_output_tokens),
          capabilities:
            rawCaps !== undefined
              ? ({
                  reasoning: typeof rawCaps.reasoning === "boolean" ? rawCaps.reasoning : undefined,
                  thinking: typeof rawCaps.thinking === "boolean" ? rawCaps.thinking : undefined,
                  tool_calling:
                    typeof rawCaps.tool_calling === "boolean" ? rawCaps.tool_calling : undefined,
                  vision: typeof rawCaps.vision === "boolean" ? rawCaps.vision : undefined,
                } as ProviderModel["capabilities"])
              : undefined,
        });
      }

      return { status: "success", models };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to fetch provider models.",
        models: [],
      };
    }
  });

const testProviderConnectionAction = createServerFn({ method: "GET" })
  .validator((input: FetchProviderModelsInput) => input)
  .handler(async ({ data: input }): Promise<{ status: "success" | "error"; message: string }> => {
    try {
      await requireOrgPermission(input.organizationId, { model: ["read"] });
      await requireOrganization(input.organizationId);

      const baseUrl = input.providerBaseUrl.replace(/\/$/, "");
      const endpoint =
        (input.modelsEndpoint !== undefined ? input.modelsEndpoint.replace(/^\//, "") : "") ||
        "models";
      const url = `${baseUrl}/${endpoint}`;

      const headers: Record<string, string> = { accept: "application/json" };
      if (input.apiKey !== undefined && input.apiKey.length > 0) {
        headers.authorization = `Bearer ${input.apiKey}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        return {
          status: "error",
          message: `Connection failed: ${response.status} ${response.statusText}`,
        };
      }

      return { status: "success", message: `Connected successfully (${response.status})` };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Connection failed.",
      };
    }
  });

export type { FetchProviderModelsInput, FetchProviderModelsResult, ProviderModel };
export { fetchProviderModelsAction, testProviderConnectionAction };
