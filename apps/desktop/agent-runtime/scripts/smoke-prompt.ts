import { join } from "node:path";

const expectedText = "KIRA_RUNTIME_OK";
const timeoutMs = 120_000;
const projectPath = process.env.KIRA_AGENT_RUNTIME_SMOKE_CWD ?? process.cwd();

const child = Bun.spawn(["bun", "src/main.ts"], {
  cwd: join(import.meta.dir, ".."),
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

let stdoutBuffer = "";
let stderrBuffer = "";
let sawExpectedText = false;
let sawAgentEnd = false;
let sawPersistenceCheckpoint = false;
let sawGetState = false;
let sawGetMessages = false;
let sawGetCommands = false;
let sawAbort = false;
let sentPostPromptCommands = false;

const timeout = setTimeout(() => {
  child.kill();
  fail(`Timed out after ${timeoutMs}ms waiting for agent response.`);
}, timeoutMs);

const stdoutPromise = readStdout();
const stderrPromise = readStderr();

sendCommand({
  id: "init",
  type: "app:initialize_thread",
  threadId: "smoke-thread",
  projectPath,
});
sendCommand({ id: "state-before", type: "get_state" });
sendCommand({
  id: "prompt",
  type: "prompt",
  message: `Reply with exactly: ${expectedText}`,
});

const exitCode = await child.exited;
await Promise.all([stdoutPromise, stderrPromise]);
clearTimeout(timeout);

if (exitCode !== 0) {
  fail(`Runtime exited with code ${exitCode}. stderr:\n${stderrBuffer}`);
}
if (!sawExpectedText) {
  fail(`Did not find expected assistant text ${expectedText}. stdout:\n${stdoutBuffer}`);
}
if (!sawAgentEnd) {
  fail(`Did not observe pi:event agent_end. stdout:\n${stdoutBuffer}`);
}
if (!sawPersistenceCheckpoint) {
  fail(`Did not observe app:persistence_checkpoint. stdout:\n${stdoutBuffer}`);
}
if (!sawGetState) {
  fail(`Did not observe successful get_state response. stdout:\n${stdoutBuffer}`);
}
if (!sawGetMessages) {
  fail(`Did not observe successful get_messages response. stdout:\n${stdoutBuffer}`);
}
if (!sawGetCommands) {
  fail(`Did not observe successful get_commands response. stdout:\n${stdoutBuffer}`);
}
if (!sawAbort) {
  fail(`Did not observe successful abort response. stdout:\n${stdoutBuffer}`);
}

process.stdout.write(`Smoke prompt passed: ${expectedText}\n`);

async function readStdout(): Promise<void> {
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  while (true) {
    // Streaming reads are sequential by design.
    // eslint-disable-next-line no-await-in-loop
    const chunk = await reader.read();
    if (chunk.done) {
      return;
    }

    stdoutBuffer += chunk.value;
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      handleRuntimeLine(line);
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  }
}

async function readStderr(): Promise<void> {
  const reader = child.stderr.pipeThrough(new TextDecoderStream()).getReader();
  while (true) {
    // Streaming reads are sequential by design.
    // eslint-disable-next-line no-await-in-loop
    const chunk = await reader.read();
    if (chunk.done) {
      return;
    }
    stderrBuffer += chunk.value;
  }
}

function sendCommand(command: Record<string, unknown>): void {
  child.stdin.write(`${JSON.stringify(command)}\n`);
}

function handleRuntimeLine(line: string): void {
  if (line.length === 0) {
    return;
  }

  const record = JSON.parse(line) as RuntimeSmokeRecord;
  if (JSON.stringify(record).includes(expectedText)) {
    sawExpectedText = true;
  }
  if (
    record.type === "pi:event" &&
    record.event !== undefined &&
    record.event.type === "agent_end"
  ) {
    sawAgentEnd = true;
  }
  if (record.type === "app:persistence_checkpoint") {
    sawPersistenceCheckpoint = true;
  }
  if (record.type === "response" && record.success === false) {
    fail(`${record.command ?? "Unknown command"} failed: ${JSON.stringify(record.error)}`);
  }
  if (record.type === "response" && record.command === "get_state" && record.success === true) {
    sawGetState = true;
  }
  if (record.type === "response" && record.command === "get_messages" && record.success === true) {
    sawGetMessages = true;
  }
  if (record.type === "response" && record.command === "get_commands" && record.success === true) {
    sawGetCommands = true;
  }
  if (record.type === "response" && record.command === "abort" && record.success === true) {
    sawAbort = true;
  }
  if (sawExpectedText && sawAgentEnd && sawPersistenceCheckpoint && !sentPostPromptCommands) {
    sentPostPromptCommands = true;
    sendCommand({ id: "messages", type: "get_messages" });
    sendCommand({ id: "commands", type: "get_commands" });
    sendCommand({ id: "abort", type: "abort" });
  }
  if (sawGetMessages && sawGetCommands && sawAbort) {
    sendCommand({ id: "shutdown", type: "app:shutdown" });
    child.stdin.end();
  }
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

type RuntimeSmokeRecord = {
  readonly type?: string;
  readonly command?: string;
  readonly success?: boolean;
  readonly error?: unknown;
  readonly event?: {
    readonly type?: string;
  };
};
