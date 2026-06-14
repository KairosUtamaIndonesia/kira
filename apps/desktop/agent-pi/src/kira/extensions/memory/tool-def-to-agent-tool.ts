import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";

/**
 * Adapt a Pi ExtensionAPI ToolDefinition to an AgentTool usable by AgentHarness.
 *
 * Both interfaces share the same execute callback signature — ToolDefinition
 * receives an extra `ctx` parameter that AgentTool omits. This adapter drops it.
 * The `onUpdate` parameter differs in generic shape between the two packages but
 * is equivalent at runtime.
 */
export function toolDefToAgentTool<TParams extends TSchema, TDetails>(
  def: ToolDefinition<TParams, TDetails>,
): AgentTool<TParams, TDetails> {
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    parameters: def.parameters,
    executionMode: def.executionMode ?? "parallel",
    prepareArguments: def.prepareArguments,
    execute(
      toolCallId: string,
      params: Static<TParams>,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<TDetails>,
    ): Promise<AgentToolResult<TDetails>> {
      return (
        def.execute as (
          id: string,
          p: Static<TParams>,
          sig: AbortSignal | undefined,
          upd: AgentToolUpdateCallback<TDetails> | undefined,
          _ctx: unknown,
        ) => Promise<AgentToolResult<TDetails>>
      )(
        toolCallId,
        params,
        signal,
        onUpdate,
        // eslint-disable-next-line unicorn/no-useless-undefined -- 5th arg satisfies cast signature
        undefined,
      );
    },
  } as AgentTool<TParams, TDetails>;
}
