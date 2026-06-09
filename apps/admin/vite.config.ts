import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  server: {
    allowedHosts: [".localhost"],
  },
  resolve: {
    alias: {
      "@": projectRoot,
    },
    dedupe: ["react", "react-dom"],
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
      },
      srcDirectory: ".",
      router: {
        routesDirectory: "app",
      },
    }),
    viteReact(),
    nitro(),
  ],
});
