/**
 * Human-in-the-loop primitive.
 *
 * A model-callable tool can suspend the agent loop by returning an unresolved
 * promise from its `execute`. `requestHumanInput` parks that promise's resolver
 * keyed by Agent Thread, and `deliverHumanResponse` resumes it when the user's
 * answer arrives over the generic `/app/agent-threads/:threadId/human-response`
 * route. Each feature (ask the user a question, request an approval, pick an
 * option) plugs in only a response parser; the suspend/resume transport here is
 * feature-agnostic and shared.
 *
 * One request may be pending per Agent Thread at a time. The root agent loop is
 * sequential, so this invariant holds; a second concurrent request (for example
 * from a delegated task sharing the instance) is rejected rather than silently
 * overwriting the first.
 */

type PendingHumanRequest = {
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
  parseResponse: (raw: unknown) => unknown;
};

const pendingRequestsByThread = new Map<string, PendingHumanRequest>();

type RequestHumanInputOptions<TResponse> = {
  threadId: string;
  parseResponse: (raw: unknown) => TResponse;
  signal?: AbortSignal | undefined;
};

/**
 * Suspends until a validated human response is delivered for `threadId`.
 *
 * Rejects if the thread already has a pending request, if the supplied signal
 * aborts, or if it was already aborted before the request started.
 */
function requestHumanInput<TResponse>(
  options: RequestHumanInputOptions<TResponse>,
): Promise<TResponse> {
  const { threadId, parseResponse, signal } = options;

  if (signal !== undefined && signal.aborted) {
    return Promise.reject(new Error("Human input was aborted before the request started."));
  }
  if (pendingRequestsByThread.has(threadId)) {
    return Promise.reject(
      new Error(
        `A human input request is already pending for Agent Thread ${threadId}. Concurrent human-in-the-loop requests on one thread are not supported.`,
      ),
    );
  }

  return new Promise<TResponse>((resolve, reject) => {
    const cleanup = () => {
      pendingRequestsByThread.delete(threadId);
      if (signal !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("Human input request was aborted."));
    };

    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort);
    }

    pendingRequestsByThread.set(threadId, {
      parseResponse: parseResponse as (raw: unknown) => unknown,
      resolve: (response) => {
        cleanup();
        resolve(response as TResponse);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
    });
  });
}

type DeliverHumanResponseResult =
  | { status: "delivered" }
  | { status: "none-pending" }
  | { status: "invalid"; reason: string };

/**
 * Delivers a raw human response to the request pending for `threadId`.
 *
 * Returns a discriminated result so the inbound route can map it to a status
 * code without knowing the feature. Validation failures leave the request
 * pending; only a successful parse resolves and clears it.
 */
function deliverHumanResponse(threadId: string, raw: unknown): DeliverHumanResponseResult {
  const entry = pendingRequestsByThread.get(threadId);
  if (entry === undefined) {
    return { status: "none-pending" };
  }

  let parsed: unknown;
  try {
    parsed = entry.parseResponse(raw);
  } catch (error) {
    return {
      status: "invalid",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  entry.resolve(parsed);
  return { status: "delivered" };
}

export { deliverHumanResponse, requestHumanInput };
export type { DeliverHumanResponseResult, RequestHumanInputOptions };
