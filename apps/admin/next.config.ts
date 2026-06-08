import type { NextConfig } from "next";

import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@better-auth/api-key",
    "@better-auth/drizzle-adapter",
    "better-auth",
    "drizzle-orm",
    "pg",
  ],
  allowedDevOrigins: ["admin.kira.localhost"],
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
