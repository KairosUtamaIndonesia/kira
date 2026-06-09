import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";

const { GET, POST } = toNextJsHandler(auth);

export const dynamic = "force-dynamic";

export { GET, POST };
