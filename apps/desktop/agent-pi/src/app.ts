import { Hono } from "hono";

import { appRoutes } from "./kira/app-routes";

const app = new Hono();

app.get("/healthz", (context) =>
  context.json({
    status: "ready",
    packageName: "@kira/agent-pi",
    runtime: "pi",
  }),
);

app.route("/app", appRoutes);

export default app;
