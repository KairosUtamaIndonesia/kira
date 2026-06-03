import type { RuntimeEvent } from "./protocol";

import { writeJsonLine } from "./jsonl";

const readyEvent: RuntimeEvent = {
  type: "app:ready",
  packageName: "@kira/agent-runtime",
};

writeJsonLine(process.stdout, readyEvent);
