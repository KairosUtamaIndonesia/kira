/**
 * Guardrails extension for the Kira desktop agent.
 */

import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadGuardrailsConfig } from "./config";
import { GrantStore } from "./grants";
import { checkCommand } from "./handlers/command-gate";
import { FilePoliciesChecker } from "./handlers/file-policies";
import { promptConfirm } from "./handlers/prompt";

function getFilePath(input: Record<string, unknown>): string | undefined {
  const path = input.path;
  if (typeof path === "string") return path;
  const file = input.file;
  if (typeof file === "string") return file;
  return undefined;
}

export default function guardrailsExtension(pi: ExtensionAPI) {
  const grants = new GrantStore();
  const filePolicies = new FilePoliciesChecker();

  pi.on("tool_call", async (event, ctx) => {
    const config = loadGuardrailsConfig();
    if (!config.enabled) return;

    const isBash = isToolCallEventType("bash", event);

    if (isBash) {
      // ── Command gate (bash tool only) ──
      if (config.features.permissionGate) {
        const command = event.input.command;
        if (typeof command === "string") {
          const result = checkCommand(command, config.permissionGate, grants);
          if (result.action === "block") {
            return { block: true, reason: result.reason };
          }
          if (result.action === "prompt") {
            const choice = await promptConfirm(ctx, {
              label: "Dangerous command",
              target: command,
              reason: result.reason,
              toolName: event.toolName,
            });
            if (choice === "allow") {
              grants.add(GrantStore.commandKey(command), "once");
            } else if (choice === "allow-session") {
              grants.add(GrantStore.commandKey(command), "session");
            } else {
              return { block: true, reason: result.reason + " User denied command." };
            }
          }
        }
      }
    } else {
      // ── File policies (non-bash tools: read/write/edit/grep/find/ls) ──
      if (config.features.policies) {
        filePolicies.compile(config.policies.rules);

        const fileArg = getFilePath(event.input as Record<string, unknown>);
        if (fileArg !== undefined) {
          const result = filePolicies.check(event.toolName, fileArg, grants);
          if (result.action === "block") {
            return { block: true, reason: result.reason };
          }
          if (result.action === "prompt") {
            const choice = await promptConfirm(ctx, {
              label: "File protection",
              target: fileArg,
              reason: result.reason,
              toolName: event.toolName,
            });
            if (choice === "allow") {
              grants.add(GrantStore.fileKey(fileArg), "once");
            } else if (choice === "allow-session") {
              grants.add(GrantStore.fileKey(fileArg), "session");
            } else {
              return { block: true, reason: result.reason + " User denied access." };
            }
          }
        }
      }
    }

    // Pass through for all other cases
    return;
  });

  pi.on("session_shutdown", async () => {
    grants.clear();
  });
}
