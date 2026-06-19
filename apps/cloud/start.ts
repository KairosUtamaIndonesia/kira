import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

import { logContext, logger } from "@/lib/log";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// ---------------------------------------------------------------------------
// Request logging middleware
// ---------------------------------------------------------------------------
// Logs every request handled by TanStack Start (server functions + router).
// Runs inside an AsyncLocalStorage context so downstream code can access the
// requestId through logContext without explicit parameter threading.
// ---------------------------------------------------------------------------

const loggingMiddleware = createMiddleware({
  type: "request",
}).server(async ({ next, request, pathname }) => {
  const requestId = crypto.randomUUID();
  const startTime = performance.now();

  const result = await logContext.run({ requestId }, async () => {
    const res = await next();
    return res;
  });

  const durationMs = Math.round(performance.now() - startTime);

  logger.info("http.request", {
    method: request.method,
    path: pathname,
    status: result.response.status,
    durationMs,
  });

  return result;
});

export const startInstance = createStart(() => ({
  defaultSsr: false,
  // loggingMiddleware must come first so every downstream middleware and
  // handler runs inside the AsyncLocalStorage requestId context.
  requestMiddleware: [loggingMiddleware, csrfMiddleware],
}));
