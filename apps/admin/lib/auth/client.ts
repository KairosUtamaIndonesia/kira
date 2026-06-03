"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { ssoClient } from "@better-auth/sso/client";
import { adminClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
  plugins: [
    organizationClient(),
    adminClient(),
    apiKeyClient(),
    ssoClient({ domainVerification: { enabled: true } }),
  ],
});

export { authClient };
