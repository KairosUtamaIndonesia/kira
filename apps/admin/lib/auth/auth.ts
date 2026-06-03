import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin, organization } from "better-auth/plugins";

import * as authSchema from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";
import { requireEnvironmentVariable } from "@/lib/env";

const betterAuthUrl = requireEnvironmentVariable("BETTER_AUTH_URL");

const auth = betterAuth({
  baseURL: betterAuthUrl,
  secret: requireEnvironmentVariable("BETTER_AUTH_SECRET"),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  experimental: {
    joins: true,
  },
  trustedOrigins: [betterAuthUrl],
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
    }),
    admin(),
    apiKey({
      configId: "organization-desktop-access",
      references: "organization",
      defaultPrefix: "kira_",
      requireName: true,
      enableMetadata: true,
      permissions: {
        defaultPermissions: {
          desktopAccess: ["read"],
        },
      },
      rateLimit: {
        enabled: true,
        timeWindow: 1000 * 60,
        maxRequests: 120,
      },
    }),
    nextCookies(),
  ],
});

export { auth };
