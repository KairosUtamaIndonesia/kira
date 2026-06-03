import {
  createRuntimeErrorResponse,
  dispatchRuntimeCommand,
  type RuntimeContext,
} from "./dispatcher";
import { readJsonLines, writeJsonLine } from "./jsonl";
import { PACKAGE_NAME, PROTOCOL_VERSION, type RuntimeEvent } from "./protocol";
import { validateRuntimeCommand } from "./validation";

const INVALID_COMMAND_ID = "invalid";
const INVALID_COMMAND_TYPE = "invalid";

const context: RuntimeContext = {
  emit: (event) => writeJsonLine(process.stdout, event),
};

const readyEvent: RuntimeEvent = {
  type: "app:ready",
  packageName: PACKAGE_NAME,
  protocolVersion: PROTOCOL_VERSION,
};

writeJsonLine(process.stdout, readyEvent);

try {
  for await (const line of readJsonLines(process.stdin)) {
    if (!line.ok) {
      writeJsonLine(
        process.stdout,
        createRuntimeErrorResponse(
          INVALID_COMMAND_ID,
          INVALID_COMMAND_TYPE,
          "invalid_json",
          "Failed to parse JSONL command.",
          {
            parseError: line.error,
            line: line.line,
          },
        ),
      );
      continue;
    }

    const validation = validateRuntimeCommand(line.value);
    if (!validation.ok) {
      writeJsonLine(
        process.stdout,
        createRuntimeErrorResponse(
          validation.commandId,
          validation.commandType,
          validation.error.code,
          validation.error.message,
          validation.error.details,
        ),
      );
      continue;
    }

    const response = await dispatchRuntimeCommand(context, validation.command);
    writeJsonLine(process.stdout, response);

    if (validation.command.type === "app:shutdown" && response.success) {
      process.exit(0);
    }
  }
} catch (error) {
  writeJsonLine(process.stdout, {
    type: "app:error",
    error: {
      code: "pi_runtime_error",
      message: error instanceof Error ? error.message : String(error),
    },
  } satisfies RuntimeEvent);
  process.exit(1);
}
