import { describe, expect, test } from "bun:test";

import { deliverHumanResponse } from "../human-in-the-loop";
import { createAskUserTool } from "./ask-user-tool";

describe("ask_user tool", () => {
  test("returns the delivered answer to the model", async () => {
    const tool = createAskUserTool("thread-ask-resolve");
    const pending = tool.execute({ question: "Which color?" });

    expect(deliverHumanResponse("thread-ask-resolve", { answer: "blue" })).toEqual({
      status: "delivered",
    });
    await expect(pending).resolves.toBe("blue");
  });

  test("rejects an empty question before suspending", async () => {
    const tool = createAskUserTool("thread-ask-empty");
    await expect(tool.execute({ question: "   " })).rejects.toThrow("non-empty 'question'");

    expect(deliverHumanResponse("thread-ask-empty", { answer: "x" })).toEqual({
      status: "none-pending",
    });
  });

  test("rejects a response whose answer is not a non-empty string", async () => {
    const tool = createAskUserTool("thread-ask-invalid");
    const pending = tool.execute({ question: "Proceed?" });

    expect(deliverHumanResponse("thread-ask-invalid", { answer: "" }).status).toBe("invalid");
    expect(deliverHumanResponse("thread-ask-invalid", { answer: 1 }).status).toBe("invalid");

    expect(deliverHumanResponse("thread-ask-invalid", { answer: "yes" })).toEqual({
      status: "delivered",
    });
    await expect(pending).resolves.toBe("yes");
  });
});
