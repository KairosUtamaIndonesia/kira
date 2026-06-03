import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@better-auth/api-key",
    "@better-auth/drizzle-adapter",
    "better-auth",
    "drizzle-orm",
    "pg",
  ],
};

export default nextConfig;
