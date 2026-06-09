import { describe, expect, test } from "bun:test";

import { deliverHumanResponse, requestHumanInput } from "./human-in-the-loop";

describe("human-in-the-loop", () => {
  test("resolves with the parsed response when one is delivered", async () => {
    const pending = requestHumanInput<string>({
      threadId: "thread-deliver",
      parseResponse: requireAnswer,
    });

    expect(deliverHumanResponse("thread-deliver", { answer: "blue" })).toEqual({
      status: "delivered",
    });
    await expect(pending).resolves.toBe("blue");
  });

  test("reports none-pending when no request is registered", () => {
    expect(deliverHumanResponse("thread-empty", { answer: "x" })).toEqual({
      status: "none-pending",
    });
  });

  test("keeps the request pending when a response fails validation", async () => {
    const pending = requestHumanInput<string>({
      threadId: "thread-invalid",
      parseResponse: requireAnswer,
    });

    const invalid = deliverHumanResponse("thread-invalid", { answer: 42 });
    expect(invalid.status).toBe("invalid");

    expect(deliverHumanResponse("thread-invalid", { answer: "corrected" })).toEqual({
      status: "delivered",
    });
    await expect(pending).resolves.toBe("corrected");
  });

  test("rejects a concurrent request on the same thread", async () => {
    const first = requestHumanInput<string>({
      threadId: "thread-concurrent",
      parseResponse: requireAnswer,
    });

    await expect(
      requestHumanInput<string>({
        threadId: "thread-concurrent",
        parseResponse: requireAnswer,
      }),
    ).rejects.toThrow("already pending");

    deliverHumanResponse("thread-concurrent", { answer: "done" });
    await expect(first).resolves.toBe("done");
  });

  test("rejects and clears the request when the abort signal fires", async () => {
    const controller = new AbortController();
    const pending = requestHumanInput<string>({
      threadId: "thread-abort",
      parseResponse: requireAnswer,
      signal: controller.signal,
    });

    controller.abort();
    await expect(pending).rejects.toThrow("aborted");

    const next = requestHumanInput<string>({
      threadId: "thread-abort",
      parseResponse: requireAnswer,
    });
    deliverHumanResponse("thread-abort", { answer: "again" });
    await expect(next).resolves.toBe("again");
  });

  test("rejects immediately when the signal is already aborted", async () => {
    await expect(
      requestHumanInput<string>({
        threadId: "thread-pre-aborted",
        parseResponse: requireAnswer,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow("aborted");

    expect(deliverHumanResponse("thread-pre-aborted", { answer: "x" })).toEqual({
      status: "none-pending",
    });
  });
});

function requireAnswer(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Response must be an object.");
  }
  const answer = (raw as Record<string, unknown>).answer;
  if (typeof answer !== "string") {
    throw new Error("answer must be a string.");
  }
  return answer;
}
