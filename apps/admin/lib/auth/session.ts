import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { auth } from "./auth";

type AuthSession = typeof auth.$Infer.Session;

const getSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  return auth.api.getSession({ headers: getRequest().headers });
});

export { getSessionFn };
export type { AuthSession };
