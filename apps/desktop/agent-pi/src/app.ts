import { Hono } from "hono";
import { cors } from "hono/cors";

import { appRoutes } from "./kira/app-routes";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/healthz", (context) =>
  context.json({
    status: "ready",
    packageName: "@kira/agent-pi",
    runtime: "pi",
  }),
);

app.route("/app", appRoutes);

export default app;
