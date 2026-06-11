import { apiKeyClient } from "@better-auth/api-key/client";
import { ssoClient } from "@better-auth/sso/client";
import { adminClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ac, admin as orgAdmin, member, owner } from "@/lib/auth/permissions";
import { clientEnv } from "@/lib/env-client";

const authClient = createAuthClient({
  baseURL: clientEnv.VITE_BETTER_AUTH_URL,
  plugins: [
    organizationClient({ ac, roles: { owner, admin: orgAdmin, member } }),
    adminClient(),
    apiKeyClient(),
    ssoClient({ domainVerification: { enabled: true } }),
  ],
});

export { authClient };
