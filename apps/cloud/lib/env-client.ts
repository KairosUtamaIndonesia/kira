import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const clientEnv = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_BETTER_AUTH_URL: z.url(),
  },
  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
});

export { clientEnv };
