import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { admin, organization } from "better-auth/plugins";

import { ac, admin as orgAdmin, member, owner } from "@/lib/auth/permissions";
import * as authSchema from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";
import { env } from "@/lib/env";

const betterAuthUrl = env.BETTER_AUTH_URL;

const auth = betterAuth({
  baseURL: betterAuthUrl,
  secret: env.BETTER_AUTH_SECRET,
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
  trustedOrigins: [
    betterAuthUrl,
    "https://login.microsoftonline.com",
    "https://graph.microsoft.com",
  ],
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      ac,
      roles: { owner, admin: orgAdmin, member },
    }),
    admin(),
    apiKey({
      configId: "organization-desktop-access",
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
    sso({
      disableImplicitSignUp: true,
      domainVerification: {
        enabled: true,
      },
      organizationProvisioning: {
        disabled: false,
        defaultRole: "member",
      },
    }),
  ],
});

export { auth };
