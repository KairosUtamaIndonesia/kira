import type { MiddlewareHandler } from "hono";

import { readRuntimeToken } from "./env";

export const requireRuntimeToken: MiddlewareHandler = async (context, next) => {
  const token = readRuntimeToken();
  const authorization = context.req.header("authorization");
  const queryToken = context.req.query("token");

  if (authorization === `Bearer ${token}` || queryToken === token) {
    await next();
    return;
  }

  return context.json(
    {
      error: {
        code: "unauthorized",
        message: "Agent runtime request is not authorized.",
      },
    },
    401,
  );
};
